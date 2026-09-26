import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerInfo } from "@/lib/multiplayer";
import { useP2PRoom } from "@/lib/multiplayer/use-p2p-room";
import {
  charsPerSecond,
  initialState,
  reduce,
  syncRoster,
  tick,
  type Action,
  type Phase,
  type State,
} from "./engine";

type Wire =
  | { kind: "full"; state: State; hostNow: number }
  | {
      kind: "tick";
      seq: number;
      qIndex: number;
      phase: Phase;
      charIndex: number;
      reading: boolean;
      graceEndsAt: number | null;
      hostNow: number;
      wpm: number;
    }
  | { kind: "action"; action: Action };

function isState(v: unknown): v is State {
  if (!v || typeof v !== "object") return false;
  const s = v as State;
  return (
    typeof s.seq === "number" &&
    typeof s.phase === "string" &&
    Array.isArray(s.roster) &&
    !!s.settings &&
    typeof s.settings.wpm === "number"
  );
}

export function useRoomMatch(code: string, name: string, claimHost: boolean) {
  const p2p = useP2PRoom({ room: `lt-${code}`, name });
  const ref = useRef<State | null>(null);
  if (ref.current === null && claimHost) {
    ref.current = initialState(p2p.selfId, name);
  }
  const [state, setState] = useState<State | null>(ref.current);
  const [seat, setSeat] = useState<"pending" | "host" | "guest">(claimHost ? "host" : "pending");
  const [offset, setOffset] = useState(0);
  const [shown, setShown] = useState(0);
  const appliedSeq = useRef(0);
  const gotRemote = useRef(false);
  const isHostRef = useRef(claimHost);
  const anchorRef = useRef({ char: 0, at: 0, reading: false, wpm: 210 });
  const sendRef = useRef(p2p.send);
  const broadcastRef = useRef(p2p.broadcast);
  sendRef.current = p2p.send;
  broadcastRef.current = p2p.broadcast;
  isHostRef.current = seat === "host";

  const noteOffset = (hostNow: number) => {
    if (typeof hostNow === "number") setOffset(hostNow - Date.now());
  };

  const commit = useCallback((next: State) => {
    ref.current = next;
    setState(next);
    if (!isHostRef.current) return;
    sendRef.current({ kind: "full", state: next, hostNow: Date.now() } satisfies Wire);
  }, []);

  useEffect(() => {
    if (claimHost || seat !== "pending") return;
    if (!p2p.joined || p2p.peers.length > 0) return;
    const timer = window.setTimeout(() => {
      if (gotRemote.current || ref.current) return;
      const next = initialState(p2p.selfId, name);
      ref.current = next;
      setState(next);
      setSeat("host");
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [claimHost, name, p2p.joined, p2p.peers.length, p2p.selfId, seat]);

  useEffect(() => {
    return p2p.onMessage((_from, data) => {
      const msg = data as Wire;
      if (!msg || typeof msg !== "object") return;

      if (msg.kind === "full" && isState(msg.state)) {
        if (isHostRef.current) {
          if (msg.state.hostId && msg.state.hostId < p2p.selfId) {
            isHostRef.current = false;
            setSeat("guest");
            appliedSeq.current = 0;
          } else {
            return;
          }
        }
        if (msg.state.seq < appliedSeq.current) return;
        appliedSeq.current = msg.state.seq;
        gotRemote.current = true;
        ref.current = msg.state;
        setState(msg.state);
        setSeat("guest");
        noteOffset(msg.hostNow);
        anchorRef.current = {
          char: msg.state.charIndex,
          at: performance.now(),
          reading: msg.state.phase === "reading" && msg.state.reading,
          wpm: msg.state.settings.wpm,
        };
        return;
      }

      if (isHostRef.current) {
        if (msg.kind !== "action") return;
        const action = msg.action;
        if (
          !action ||
          (action.type !== "buzz" && action.type !== "answer" && action.type !== "chat" && action.type !== "team")
        ) {
          return;
        }
        const cur = ref.current;
        if (!cur) return;
        const stamped = { ...action, playerId: _from } as Action;
        const next = reduce(cur, stamped, Date.now());
        if (next !== cur) commit(next);
        return;
      }

      if (msg.kind === "tick") {
        const cur = ref.current;
        if (!cur || msg.seq < appliedSeq.current) return;
        if (msg.qIndex !== cur.qIndex || msg.phase !== cur.phase) return;
        appliedSeq.current = msg.seq;
        noteOffset(msg.hostNow);
        anchorRef.current = {
          char: msg.charIndex,
          at: performance.now(),
          reading: msg.reading && msg.phase === "reading",
          wpm: msg.wpm,
        };
        const next = {
          ...cur,
          charIndex: msg.charIndex,
          reading: msg.reading,
          graceEndsAt: msg.graceEndsAt,
          seq: msg.seq,
        };
        ref.current = next;
        setState(next);
      }
    });
  }, [commit, p2p.onMessage]);

  useEffect(() => {
    if (seat !== "host") return;
    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cur = ref.current;
      if (cur && isHostRef.current) {
        const result = tick(cur, dt, Date.now());
        if (result.kind === "event") {
          commit(result.state);
        } else if (result.kind === "tick") {
          ref.current = result.state;
          if (Math.floor(result.state.charIndex) !== Math.floor(cur.charIndex)) setState(result.state);
          if (now - lastTick > 200) {
            lastTick = now;
            const stamped = { ...ref.current, seq: ref.current.seq + 1 };
            ref.current = stamped;
            broadcastRef.current({
              kind: "tick",
              seq: stamped.seq,
              qIndex: stamped.qIndex,
              phase: stamped.phase,
              charIndex: stamped.charIndex,
              reading: stamped.reading,
              graceEndsAt: stamped.graceEndsAt,
              hostNow: Date.now(),
              wpm: stamped.settings.wpm,
            } satisfies Wire);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [commit, seat]);

  useEffect(() => {
    if (seat !== "host") return;
    const id = window.setInterval(() => {
      const cur = ref.current;
      if (!cur || !isHostRef.current) return;
      sendRef.current({ kind: "full", state: cur, hostNow: Date.now() } satisfies Wire);
    }, 1600);
    return () => window.clearInterval(id);
  }, [seat]);

  const peerKey = p2p.peers.map((p) => `${p.id}:${p.name}:${p.connectionState}`).join("|");

  useEffect(() => {
    if (seat !== "host") return;
    const cur = ref.current;
    if (!cur) return;
    const people = [
      { id: p2p.selfId, name },
      ...p2p.peers
        .filter((p) => p.connectionState === "connected")
        .map((p) => ({ id: p.id, name: p.name || "Player" })),
    ];
    const next = syncRoster(cur, people);
    if (next !== cur) {
      if (next.hostId !== p2p.selfId) next.hostId = p2p.selfId;
      commit(next);
    }
  }, [commit, name, p2p.peers, p2p.selfId, peerKey, seat]);

  useEffect(() => {
    if (seat !== "guest" || !p2p.joined || !ref.current) return;
    const hostId = ref.current.hostId;
    if (!hostId || hostId === p2p.selfId) return;
    if (p2p.peers.some((p) => p.id === hostId)) return;
    const ids = [p2p.selfId, ...p2p.peers.map((p) => p.id)].sort();
    if (ids[0] !== p2p.selfId) return;
    const next = { ...ref.current, hostId: p2p.selfId, seq: ref.current.seq + 1 };
    ref.current = next;
    setState(next);
    setSeat("host");
    sendRef.current({ kind: "full", state: next, hostNow: Date.now() } satisfies Wire);
  }, [p2p.joined, p2p.peers, p2p.selfId, seat]);

  useEffect(() => {
    if (seat === "host") return;
    let raf = 0;
    let lastShown = -1;
    const loop = () => {
      const cur = ref.current;
      const anchor = anchorRef.current;
      let n = 0;
      if (!cur) n = 0;
      else if (cur.phase === "reveal" || cur.phase === "complete") n = Math.floor(cur.charIndex);
      else if (anchor.reading) {
        const elapsed = Math.min(0.45, (performance.now() - anchor.at) / 1000);
        n = Math.floor(anchor.char + elapsed * charsPerSecond(anchor.wpm));
      } else n = Math.floor(anchor.char);
      if (n !== lastShown) {
        lastShown = n;
        setShown(n);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [seat]);

  const act = useCallback(
    (action: Action) => {
      if (isHostRef.current) {
        const cur = ref.current;
        if (!cur) return;
        const next = reduce(cur, action, Date.now());
        if (next !== cur) commit(next);
        return;
      }
      const relay =
        action.type === "buzz" || action.type === "answer" || action.type === "chat" || action.type === "team"
          ? action
          : null;
      if (!relay) return;
      sendRef.current({ kind: "action", action: relay } satisfies Wire);
    },
    [commit],
  );

  const shownChar = seat === "host" && state ? Math.floor(state.charIndex) : shown;

  return {
    state,
    selfId: p2p.selfId,
    isHost: seat === "host",
    shown: shownChar,
    clockOffset: offset,
    joined: p2p.joined,
    peers: p2p.peers as PeerInfo[],
    act,
    waiting: !state,
  };
}
