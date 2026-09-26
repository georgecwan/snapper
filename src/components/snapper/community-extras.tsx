import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Trophy } from "lucide-react";
import {
  AVATARS,
  actionSchema,
  type GameAction,
  type PlayerView,
  type SessionView,
  type Team,
} from "@/snapper/protocol";
import {
  AVATAR_LABELS,
  playerAvatar,
  playerColor,
  scoreLeaders,
  teamName,
} from "@/snapper/identity";
import { Modal } from "./app";
import "./community-extras.css";

type SendAction = (action: GameAction) => boolean;

export function AnimatedScore({ value, className = "" }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [changing, setChanging] = useState(false);
  const shownRef = useRef(value);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const from = shownRef.current;
    if (reducedMotion || from === value) {
      shownRef.current = value;
      setShown(value);
      setChanging(false);
      return;
    }
    setChanging(true);
    let frame: number;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 380);
      const next = Math.round(from + (value - from) * (1 - (1 - progress) ** 3));
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(animate);
      else setChanging(false);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value, reducedMotion]);
  return (
    <span className={`animated-score ${className}`}>
      <span key={value} aria-hidden="true" className={changing ? "score-is-changing" : undefined}>
        {shown}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}

export function AvatarPicker({
  player,
  send,
  connected,
  onClose,
  returnFocus,
}: {
  player: PlayerView;
  send: SendAction;
  connected: boolean;
  onClose: () => void;
  returnFocus: HTMLElement;
}) {
  const selected = playerAvatar(player);
  const initialFocus = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      title="Choose your avatar"
      onClose={onClose}
      initialFocus={initialFocus}
      returnFocus={returnFocus}
    >
      <p className="community-editor-note">Your avatar is for this session.</p>
      <div className="avatar-picker" role="group" aria-label="Available avatars">
        {AVATARS.map((avatar) => (
          <button
            key={avatar}
            type="button"
            ref={avatar === selected ? initialFocus : undefined}
            className={`avatar-option ${avatar === selected ? "is-selected" : ""}`}
            aria-label={AVATAR_LABELS[avatar]}
            aria-pressed={avatar === selected}
            disabled={!connected}
            onClick={() => {
              if (send({ type: "avatar", avatar })) onClose();
            }}
          >
            <span aria-hidden="true">{avatar}</span>
            {avatar === selected && <Check size={13} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function TeamNameEditor({
  state,
  team,
  send,
  connected,
  onClose,
  returnFocus,
}: {
  state: SessionView;
  team: Team;
  send: SendAction;
  connected: boolean;
  onClose: () => void;
  returnFocus: HTMLElement;
}) {
  const [name, setName] = useState(teamName(state, team));
  const [error, setError] = useState("");
  const initialFocus = useRef<HTMLInputElement>(null);
  return (
    <Modal
      title={`Rename team ${team}`}
      onClose={onClose}
      initialFocus={initialFocus}
      returnFocus={returnFocus}
    >
      <form
        className="team-name-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (!connected) return;
          const result = actionSchema.safeParse({ type: "rename-team", team, name });
          if (!result.success) {
            setError("Use a team name between 1 and 24 characters.");
            return;
          }
          if (send(result.data)) onClose();
        }}
      >
        <label htmlFor="session-team-name">Team name</label>
        <input
          ref={initialFocus}
          id="session-team-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          maxLength={24}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "team-name-error" : "team-name-note"}
        />
        <p id="team-name-note" className="community-editor-note">
          Up to 24 characters. This name lasts for this session.
        </p>
        {error && (
          <p id="team-name-error" className="team-name-error" role="alert">
            {error}
          </p>
        )}
        <div className="community-editor-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!connected}>
            Save name
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MobileScoreStrip({
  state,
  onScores,
}: {
  state: SessionView;
  onScores: () => void;
}) {
  const self = state.players.find((player) => player.id === state.selfId);
  const leaders = scoreLeaders(state.players);
  const leader = leaders[0];
  const selfIsPlayer = self?.role === "player";
  const leaderName = leaders.length > 1 ? `${leaders.length} tied` : (leader?.name ?? "No players");
  return (
    <div className="mobile-score-strip" role="region" aria-label="Current scores">
      {state.config.mode === "teams" ? (
        (["A", "B"] as const).map((team) => (
          <div className={`mobile-score-card team-${team.toLowerCase()}`} key={team}>
            <span className="mobile-score-name" title={`${teamName(state, team)} (team ${team})`}>
              <span className="team-letter">{team}</span>
              <span>
                {teamName(state, team)}
                {selfIsPlayer && self?.team === team && <small>you</small>}
              </span>
            </span>
            <strong>
              <AnimatedScore value={state.teamScores[team]} />
            </strong>
          </div>
        ))
      ) : (
        <>
          {self && selfIsPlayer && (
            <div className="mobile-score-card">
              <span className="mobile-score-name">
                <span
                  className={`mobile-score-avatar avatar-${playerColor(self.id)}`}
                  aria-hidden="true"
                >
                  {playerAvatar(self)}
                </span>
                You
              </span>
              <strong>
                <AnimatedScore value={self.score} />
              </strong>
            </div>
          )}
          <div className="mobile-score-card mobile-leader">
            <span className="mobile-score-name" title={leaderName}>
              <Trophy size={13} aria-hidden="true" />
              <span>
                {leaderName}
                <small>{leaders.length > 1 ? "for the lead" : leader ? "leader" : "waiting"}</small>
              </span>
            </span>
            <strong>
              <AnimatedScore value={leader?.score ?? 0} />
            </strong>
          </div>
        </>
      )}
      <button
        type="button"
        className="mobile-scores-button"
        onClick={onScores}
        aria-label="Show full scoreboard"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
