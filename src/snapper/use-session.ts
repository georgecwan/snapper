import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientCommand, GameAction, ServerMessage, SessionView, SiteStatus } from "./protocol";

export type Connection =
  | "loading"
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "replaced"
  | "unavailable";
const API = "/api/snapper";

export function useSession() {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [connection, setConnection] = useState<Connection>("loading");
  const [error, setError] = useState<string | null>(null);
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const viewRef = useRef<SessionView | null>(null);
  const stopped = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`${API}/status`, {
      credentials: "include",
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("The lobby is temporarily unavailable. Please try again.");
    const next = (await response.json()) as SiteStatus;
    if (mounted.current) {
      setStatus(next);
      setConnection((current) =>
        current === "loading" || current === "unavailable" ? "idle" : current,
      );
    }
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The lobby could not be reached.");
        setConnection("unavailable");
      }
    });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [refresh]);

  // A pending admission is the server's record of an explicit request to join.
  // Closed pages and unrequested visitors never start a polling loop.
  useEffect(() => {
    if (!status?.active || status.admission !== "pending" || stopped.current) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await refresh(controller.signal);
        if (!controller.signal.aborted && next.active && next.admission === "pending")
          timer = setTimeout(poll, 2000);
      } catch {
        if (!controller.signal.aborted) {
          setError("Approval updates were interrupted. Check the lobby to reconnect.");
          setConnection("unavailable");
        }
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [status?.active, status?.admission, status?.sessionId, epoch, refresh]);

  useEffect(() => {
    if (!status?.active || status.admission !== "approved" || !status.sessionId || stopped.current)
      return;
    let disposed = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const connect = () => {
      if (disposed || stopped.current) return;
      setConnection(attempts ? "reconnecting" : "connecting");
      const url = new URL(`${API}/connect`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      socket.current = ws;
      ws.onopen = () => {
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 20000);
      };
      ws.onmessage = (event) => {
        if (disposed || stopped.current) return;
        if (event.data === "pong") return;
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "state") {
          if (
            viewRef.current?.sessionId === message.state.sessionId &&
            message.state.revision < viewRef.current.revision
          )
            return;
          attempts = 0;
          setConnection("connected");
          setError(null);
          viewRef.current = message.state;
          setView(message.state);
          setClockOffset(message.state.serverTime - Date.now());
        } else if (message.type === "reading") {
          setView((current) => {
            if (!current?.question || current.question.id !== message.questionId) return current;
            const next = {
              ...current,
              question: {
                ...current.question,
                text: message.text,
                readingComplete: message.readingComplete,
              },
            };
            viewRef.current = next;
            return next;
          });
        } else if (message.type === "error") {
          setError(message.message);
        } else if (message.type === "ended" || message.type === "replaced") {
          stopped.current = true;
          setConnection(message.type);
          setTerminalMessage(message.message);
          setView(null);
          viewRef.current = null;
          ws.close();
          if (message.type === "ended") void refresh().catch(() => undefined);
        }
      };
      ws.onclose = () => {
        clearInterval(heartbeat);
        if (disposed || stopped.current) return;
        if (socket.current === ws) socket.current = null;
        setConnection("reconnecting");
        attempts += 1;
        retryTimer = setTimeout(
          async () => {
            try {
              const next = await refresh(controller.signal);
              if (disposed || stopped.current) return;
              if (!next.active || next.sessionId !== status.sessionId) {
                stopped.current = true;
                setView(null);
                viewRef.current = null;
                setConnection("ended");
                setTerminalMessage("This session has ended. The owner can open a new one.");
              } else if (next.admission !== "approved") {
                setView(null);
                viewRef.current = null;
                setConnection("idle");
              } else connect();
            } catch {
              if (!disposed && !controller.signal.aborted) connect();
            }
          },
          Math.min(30000, 750 * 2 ** Math.min(attempts - 1, 6)),
        );
      };
      ws.onerror = () => {
        /* onclose owns the bounded backoff. */
      };
    };
    connect();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(retryTimer);
      socket.current?.close();
      socket.current = null;
    };
  }, [status?.active, status?.admission, status?.sessionId, epoch, refresh]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`${API}/${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok)
          throw new Error(result.error || "That action could not be completed. Please try again.");
        if (path === "logout") {
          // Stop before closing: the old socket may deliver its close event after
          // the logout response or the following status refresh has completed.
          stopped.current = true;
          const previousSocket = socket.current;
          socket.current = null;
          previousSocket?.close();
          setView(null);
          viewRef.current = null;
          setConnection("idle");
        } else if (path === "open" || path === "request") {
          stopped.current = false;
        }
        setTerminalMessage(null);
        await refresh();
        setEpoch((value) => value + 1);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That action could not be completed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const renderedSessionId = view?.sessionId;
  const renderedQuestionId = view?.question?.id ?? null;
  const send = useCallback(
    (action: GameAction) => {
      const current = viewRef.current;
      if (!current || socket.current?.readyState !== WebSocket.OPEN || stopped.current) {
        setError("You're reconnecting. Wait for the connection before trying again.");
        return false;
      }
      if (current.sessionId !== renderedSessionId) {
        setError("That session has changed. Please try again.");
        return false;
      }
      const command: ClientCommand = {
        id: crypto.randomUUID(),
        sessionId: current.sessionId,
        // Keep the question that the visible action referred to. A delayed
        // confirmation must not silently target an auto-advanced question.
        questionId: renderedQuestionId,
        action,
      };
      socket.current.send(JSON.stringify(command));
      return true;
    },
    [renderedSessionId, renderedQuestionId],
  );

  const retry = useCallback(async () => {
    if (connection === "replaced") return;
    setError(null);
    stopped.current = false;
    setTerminalMessage(null);
    setConnection("loading");
    try {
      await refresh();
      setEpoch((value) => value + 1);
    } catch {
      setConnection("unavailable");
      setError("The lobby is still unavailable. Please try again shortly.");
    }
  }, [connection, refresh]);

  return {
    status,
    view,
    connection,
    error,
    terminalMessage,
    busy,
    clockOffset,
    post,
    send,
    retry,
    clearError: () => setError(null),
  };
}

export type SessionController = ReturnType<typeof useSession>;
