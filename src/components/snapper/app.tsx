import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowRight,
  Clock3,
  Crown,
  Flag,
  Github,
  Hand,
  LogOut,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { FORMAT_LABELS, FORMATS, type RoomConfig } from "@/snapper/protocol";
import { useSession, type SessionController } from "@/snapper/use-session";
import { ConfigPanel } from "./config-panel";
import { Game, type Confirm } from "./game";

export const FORMAT_DESCRIPTIONS = {
  tossup: "Progressive clues. A correct answer before the power mark earns bonus points.",
  snapper: "A short question open to all eligible players.",
  open: "A few related questions, with a fresh chance to score on every part.",
  sequence: "Put every item in the right order. Separate your answers with commas.",
  team: "Win the scramble to earn three exclusive questions for your team.",
  assigned: "A question assigned to one player. A miss passes to the designated opponent.",
  clues: "Four clues, one answer. The earlier you know it, the more you score.",
  shootout: "A correct answer takes you out of the current cycle until every player has scored.",
} as const;

function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Zap size={24} strokeWidth={3} fill="currentColor" />
      </span>
      <span>
        snapper<span className="brand-dot">.</span>
      </span>
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  initialFocus,
  returnFocus,
  descriptionId,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: HTMLElement | null;
  descriptionId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef(false);
  const outsideDialog = (node: HTMLDialogElement, x: number, y: number) => {
    const bounds = node.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  };
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    initialFocus?.current?.focus({ preventScroll: true });
    return () => {
      node?.close();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [initialFocus, returnFocus]);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      aria-describedby={descriptionId}
      className={`snap-modal ${wide ? "modal-wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPointer.current =
          event.target === event.currentTarget &&
          outsideDialog(event.currentTarget, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (
          backdropPointer.current &&
          event.target === event.currentTarget &&
          outsideDialog(event.currentTarget, event.clientX, event.clientY)
        )
          onClose();
        backdropPointer.current = false;
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function useSound() {
  const [muted, setMuted] = useState(true);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem("snapper-muted") !== "false");
    } catch {
      /* Optional preference. */
    }
    return () => {
      void audio.current?.close();
    };
  }, []);
  const unlock = useCallback(() => {
    try {
      audio.current ??= new AudioContext();
      if (audio.current.state === "suspended") void audio.current.resume();
    } catch {
      /* Audio is optional. */
    }
  }, []);
  const play = useCallback(
    (kind: "buzz" | "accept" | "reject") => {
      if (muted || !audio.current || audio.current.state !== "running") return;
      try {
        const ctx = audio.current,
          osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.type = kind === "buzz" ? "triangle" : "sine";
        osc.frequency.setValueAtTime(
          kind === "accept" ? 660 : kind === "reject" ? 180 : 330,
          ctx.currentTime,
        );
        osc.frequency.exponentialRampToValueAtTime(
          kind === "accept" ? 880 : kind === "reject" ? 100 : 220,
          ctx.currentTime + 0.14,
        );
        gain.gain.setValueAtTime(0.045, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.21);
      } catch {
        /* Sound must never interrupt play. */
      }
    },
    [muted],
  );
  const toggle = () => {
    unlock();
    setMuted((current) => {
      try {
        localStorage.setItem("snapper-muted", String(!current));
      } catch {
        /* Optional preference. */
      }
      return !current;
    });
  };
  return { muted, toggle, play, unlock };
}

export function SnapperApp() {
  const session = useSession(),
    sound = useSound();
  const playSound = sound.play;
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const message = url.searchParams.get("authError");
    if (message) setAuthError(message.slice(0, 300));
  }, []);
  const dismissAuthError = () => {
    setAuthError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("authError");
    window.history.replaceState(window.history.state, "", url);
  };
  const [panel, setPanel] = useState<"rules" | "formats" | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    text: string;
    action: () => boolean | void;
    label: string;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  const confirmationDescription = useId();
  const self = session.view?.players.find((player) => player.id === session.view?.selfId);
  const observed = useRef<{
    questionId: string;
    answerer: string | null;
    attemptIds: Set<string>;
  } | null>(null);
  useEffect(() => {
    const state = session.view;
    if (!state?.question) return;
    const previous = observed.current;
    if (previous?.questionId === state.question.id) {
      if (state.answererId && state.answererId !== previous.answerer) playSound("buzz");
      for (const attempt of state.attempts)
        if (!previous.attemptIds.has(attempt.id) && attempt.verdict !== "prompt")
          playSound(attempt.verdict);
    }
    observed.current = {
      questionId: state.question.id,
      answerer: state.answererId,
      attemptIds: new Set(state.attempts.map((item) => item.id)),
    };
  }, [session.view, playSound]);
  const confirm: Confirm = (title, text, action, label = "Confirm") => {
    const active = document.activeElement;
    const returnFocus =
      active instanceof HTMLElement
        ? (active.closest("details[data-action-menu]")?.querySelector("summary") ?? active)
        : null;
    session.clearError();
    setConfirmation({ title, text, action, label, returnFocus });
  };
  const config = self?.owner
    ? (session.view?.pendingConfig ?? session.view?.config ?? session.status?.config)
    : (session.view?.config ?? session.status?.config);
  return (
    <div className="snapper-app">
      <a className="skip-link" href="#main-content">
        Skip to game
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Logo />
          <div className="header-center">
            {session.view ? (
              <span
                className={`connection-pill ${session.connection === "connected" ? "is-live" : "is-reconnecting"}`}
              >
                <span className="status-dot" />
                {session.connection === "connected" ? "Lobby live" : "Reconnecting"}
              </span>
            ) : (
              <span className="header-tagline">Private quiz lobby</span>
            )}
          </div>
          <nav className="header-actions" aria-label="Lobby tools">
            <button
              className="icon-button"
              onClick={sound.toggle}
              title={sound.muted ? "Turn sound on" : "Mute sound"}
              aria-label={sound.muted ? "Turn sound on" : "Mute sound"}
            >
              {sound.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button
              className="button quiet rules-button"
              aria-label={self?.owner ? "Lobby settings" : "Room rules"}
              onClick={() => setPanel("rules")}
              disabled={!config}
            >
              <Settings2 size={18} />
              <span>{self?.owner ? "Lobby settings" : "The rules"}</span>
            </button>
            {session.view && (
              <button
                className="icon-button"
                aria-label="Leave lobby"
                title="Leave lobby"
                onClick={() =>
                  confirm(
                    "Leave the lobby?",
                    "If you're the last connected player, this ends the session for everyone. Your nickname will stay saved on this browser.",
                    () => {
                      void session.post("logout");
                    },
                  )
                }
              >
                <LogOut size={19} />
              </button>
            )}
          </nav>
        </div>
      </header>
      {authError && (
        <div className="error-banner" role="alert">
          <span>Owner sign-in: {authError}</span>
          <button aria-label="Dismiss sign-in message" onClick={dismissAuthError}>
            <X size={17} />
          </button>
        </div>
      )}
      {session.error && (
        <div className="error-banner" role="alert">
          <span>{session.error}</span>
          <button aria-label="Dismiss message" onClick={session.clearError}>
            <X size={17} />
          </button>
        </div>
      )}
      {session.view ? (
        <Game session={session} unlockSound={sound.unlock} confirm={confirm} />
      ) : (
        <Landing session={session} />
      )}
      <footer className="site-footer">
        <button onClick={() => setPanel("formats")}>
          Question formats <ArrowRight size={13} />
        </button>
      </footer>
      {panel === "rules" && config && (
        <Modal
          title={self?.owner ? "Lobby settings" : "Lobby rules"}
          wide
          onClose={() => setPanel(null)}
        >
          <ConfigPanel
            config={config}
            editable={Boolean(self?.owner)}
            pending={Boolean(session.view?.pendingConfig)}
            onSave={(next: RoomConfig) => {
              if (session.send({ type: "configure", config: next })) setPanel(null);
            }}
          />
        </Modal>
      )}
      {panel === "formats" && (
        <Modal title="Question formats" onClose={() => setPanel(null)}>
          <p className="panel-intro">The game selects a playable format for each block.</p>
          <div className="format-guide">
            {FORMATS.map((format, index) => (
              <article key={format}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{FORMAT_LABELS[format]}</h3>
                  <p>
                    {FORMAT_DESCRIPTIONS[format]}
                    {format === "team" && " Available in team mode."}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          descriptionId={confirmationDescription}
          initialFocus={cancelConfirmation}
          returnFocus={confirmation.returnFocus}
          onClose={() => setConfirmation(null)}
        >
          <p className="panel-intro" id={confirmationDescription}>
            {confirmation.text}
          </p>
          {session.error && <p role="alert">{session.error}</p>}
          <div className="confirm-actions">
            <button
              ref={cancelConfirmation}
              className="button secondary"
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (confirmation.action() !== false) setConfirmation(null);
              }}
            >
              {confirmation.label} <ArrowRight size={17} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Landing({ session }: { session: SessionController }) {
  const { status, connection, busy, terminalMessage } = session;
  const [name, setName] = useState("");
  const [role, setRole] = useState<"player" | "spectator">("player");
  useEffect(() => {
    try {
      setName(localStorage.getItem("snapper-nickname") ?? "");
    } catch {
      /* Optional preference. */
    }
  }, []);
  const submit = (path: "open" | "request") => {
    if (!name.trim()) return;
    try {
      localStorage.setItem("snapper-nickname", name.trim());
    } catch {
      /* Optional preference. */
    }
    void session.post(path, { name: name.trim(), ...(path === "request" ? { role } : {}) });
  };
  const terminal = connection === "ended" || connection === "replaced";
  const connecting = connection === "connecting" || connection === "reconnecting";
  return (
    <main id="main-content" className="landing">
      {status?.admission === "none" && status.message && (
        <div className="inline-notice" role="status">
          {status.message}
        </div>
      )}
      <section className="join-card" aria-labelledby="join-title">
        <div className="join-card-top">
          <span className={`connection-pill ${status?.active ? "is-live" : ""}`}>
            <span className="status-dot" />
            {connection === "loading"
              ? "Checking the lobby"
              : status?.active
                ? "Lobby open"
                : "Lobby closed"}
          </span>
          <span className="ticket-number">16 PLAYER SEATS · OWNER APPROVAL REQUIRED</span>
        </div>
        {connection === "loading" ? (
          <div className="gate-state">
            <span className="loading-ring" />
            <h2 id="join-title">Checking lobby…</h2>
            <p>One moment while we check the lobby.</p>
          </div>
        ) : terminal ? (
          <div className="gate-state">
            <span className="gate-icon">{connection === "replaced" ? <Radio /> : <Flag />}</span>
            <h2 id="join-title">
              {connection === "replaced" ? "Active in another tab" : "Session ended"}
            </h2>
            <p>{terminalMessage}</p>
            {connection !== "replaced" && (
              <button className="button primary" onClick={() => void session.retry()}>
                Back to the lobby <ArrowRight size={18} />
              </button>
            )}
          </div>
        ) : status?.admission === "pending" && connection !== "unavailable" ? (
          <div className="gate-state">
            <span className="gate-icon yellow">
              <Clock3 />
            </span>
            <h2 id="join-title">Awaiting approval</h2>
            <p>The owner will review your request. This page updates automatically.</p>
            <div className="pending-line">
              <span className="status-dot" /> Waiting for approval
            </div>
            <button
              className="button quiet"
              onClick={() => void session.post("logout")}
              disabled={busy}
            >
              Leave the queue
            </button>
          </div>
        ) : status?.admission === "rejected" ? (
          <div className="gate-state">
            <span className="gate-icon">
              <Hand />
            </span>
            <h2 id="join-title">Request declined</h2>
            <p>
              {status.message ||
                "Your request wasn't accepted for this session. Check with the owner before joining again."}
            </p>
            <button className="button secondary" onClick={() => void session.retry()}>
              Check the lobby
            </button>
          </div>
        ) : connecting || status?.admission === "approved" ? (
          <div className="gate-state">
            <span className="loading-ring" />
            <h2 id="join-title">
              {connection === "reconnecting" ? "Reconnecting…" : "Connecting…"}
            </h2>
            <p>
              {status?.message ||
                "Connecting you to the lobby. Your place is linked to this browser."}
            </p>
            <button className="button quiet" onClick={() => void session.retry()}>
              Try connection again
            </button>
          </div>
        ) : connection === "unavailable" ? (
          <div className="gate-state">
            <span className="gate-icon">
              <Radio />
            </span>
            <h2 id="join-title">Lobby unavailable</h2>
            <p>The lobby couldn't be reached. Give it a moment, then try again.</p>
            <button className="button primary" onClick={() => void session.retry()}>
              Check the lobby <RotateCcw size={17} />
            </button>
          </div>
        ) : status?.owner || status?.active ? (
          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit(status.owner ? "open" : "request");
            }}
          >
            <div className="join-heading">
              <h2 id="join-title">
                {status.owner ? (status.active ? "Rejoin lobby" : "Open lobby") : "Join lobby"}
              </h2>
              <p>
                {status.owner
                  ? status.active
                    ? "Join the active session as the owner."
                    : "Open a session and approve your friends as they join."
                  : "Pick a name and ask to join. No account needed."}
              </p>
            </div>
            <label className="name-label" htmlFor="nickname">
              Nickname
            </label>
            <input
              id="nickname"
              className="name-input"
              autoComplete="nickname"
              placeholder="Your name"
              maxLength={24}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {!status.owner && (
              <div className="segmented join-role">
                <button
                  type="button"
                  className={role === "player" ? "selected" : ""}
                  aria-pressed={role === "player"}
                  onClick={() => setRole("player")}
                >
                  Player
                </button>
                <button
                  type="button"
                  className={role === "spectator" ? "selected" : ""}
                  aria-pressed={role === "spectator"}
                  onClick={() => setRole("spectator")}
                >
                  Spectator
                </button>
              </div>
            )}
            <button
              className="button primary join-submit"
              type="submit"
              disabled={busy || !name.trim()}
            >
              {busy
                ? "One moment…"
                : status.owner
                  ? status.active
                    ? "Rejoin the lobby"
                    : "Open the lobby"
                  : "Ask to join"}
              <ArrowRight size={20} />
            </button>
            <p className="join-footnote">
              <ShieldCheck size={15} />
              {status.owner
                ? "Approve players and spectators from the lobby."
                : "The owner approves every player and spectator."}
            </p>
          </form>
        ) : (
          <div className="gate-state closed-gate">
            <span className="gate-icon yellow">
              <Sparkles />
            </span>
            <h2 id="join-title">Lobby closed</h2>
            <p>Wait for the owner to open a session, then check again to join.</p>
            <button className="button secondary" onClick={() => void session.retry()}>
              Check the lobby <RotateCcw size={17} />
            </button>
          </div>
        )}
        {!terminal && !connecting && status?.admission !== "approved" && (
          <div className="host-entry">
            {status?.owner ? (
              <>
                <span>
                  <Crown size={15} /> You're signed in as the owner
                </span>
                <button onClick={() => void session.post("logout")} disabled={busy}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <span>Owner</span>
                {status?.devAuth ? (
                  <button
                    className="host-link"
                    onClick={() => void session.post("dev-owner")}
                    disabled={busy}
                  >
                    Open local host controls <ArrowRight size={14} />
                  </button>
                ) : status?.ownerConfigured ? (
                  <a className="host-link" href="/api/snapper/auth/github">
                    <Github size={16} /> Owner sign-in <ArrowRight size={14} />
                  </a>
                ) : (
                  <span className="setup-note">Owner sign-in is being set up.</span>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
