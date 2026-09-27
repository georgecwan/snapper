import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, ChevronRight, Trophy } from "lucide-react";
import {
  AVATARS,
  MAX_SCORE_ADJUSTMENT,
  actionSchema,
  type Avatar,
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
      <AvatarChoices
        selected={selected}
        disabled={!connected}
        initialFocus={initialFocus}
        onSelect={(avatar) => {
          if (send({ type: "avatar", avatar })) onClose();
        }}
      />
    </Modal>
  );
}

function AvatarChoices({
  selected,
  disabled,
  onSelect,
  initialFocus,
}: {
  selected: Avatar;
  disabled: boolean;
  onSelect: (avatar: Avatar) => void;
  initialFocus?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="avatar-picker" role="group" aria-label="Available avatars">
      {AVATARS.map((avatar) => (
        <button
          key={avatar}
          type="button"
          ref={avatar === selected ? initialFocus : undefined}
          className={`avatar-option ${avatar === selected ? "is-selected" : ""}`}
          aria-label={AVATAR_LABELS[avatar]}
          aria-pressed={avatar === selected}
          title={AVATAR_LABELS[avatar]}
          disabled={disabled}
          onClick={() => onSelect(avatar)}
        >
          <span aria-hidden="true">{avatar}</span>
          {avatar === selected && <Check size={13} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function ParticipantEditor({
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
  const [name, setName] = useState(player.name);
  const [avatar, setAvatar] = useState(playerAvatar(player));
  const [error, setError] = useState("");
  const initialFocus = useRef<HTMLInputElement>(null);
  return (
    <Modal
      title="Edit name & icon"
      onClose={onClose}
      initialFocus={initialFocus}
      returnFocus={returnFocus}
    >
      <form
        className="participant-editor team-name-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (!connected) return;
          const result = actionSchema.safeParse({
            type: "edit-participant",
            playerId: player.id,
            name,
            avatar,
          });
          if (!result.success) {
            setError("Enter a name from 1 to 32 characters on one line.");
            return;
          }
          if (send(result.data)) onClose();
        }}
      >
        <p className="community-editor-note">Update {player.name} for this session.</p>
        <label htmlFor="participant-name">Name</label>
        <input
          ref={initialFocus}
          id="participant-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          maxLength={32}
          autoComplete="off"
          disabled={!connected}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "participant-name-error" : undefined}
        />
        {error && (
          <p id="participant-name-error" className="team-name-error" role="alert">
            {error}
          </p>
        )}
        <p className="participant-icon-label">
          Icon: <strong>{AVATAR_LABELS[avatar]}</strong>
        </p>
        <AvatarChoices selected={avatar} disabled={!connected} onSelect={setAvatar} />
        <div className="community-editor-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!connected}>
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ScoreEditor({
  player,
  state,
  send,
  connected,
  onClose,
  returnFocus,
}: {
  player: PlayerView;
  state: SessionView;
  send: SendAction;
  connected: boolean;
  onClose: () => void;
  returnFocus: HTMLElement;
}) {
  const [direction, setDirection] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("10");
  const [error, setError] = useState("");
  const initialFocus = useRef<HTMLInputElement>(null);
  const points = Number(amount);
  const delta = direction * points;
  const valid = Number.isSafeInteger(points) && points > 0 && points <= MAX_SCORE_ADJUSTMENT;
  const team = state.config.mode === "teams" ? player.team : null;
  const label = direction === 1 ? "Add points" : "Deduct points";
  return (
    <Modal
      title="Adjust points"
      onClose={onClose}
      initialFocus={initialFocus}
      returnFocus={returnFocus}
    >
      <form
        className="team-name-editor score-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (!connected) return;
          const result = actionSchema.safeParse({
            type: "adjust-score",
            playerId: player.id,
            delta,
          });
          if (!valid || !result.success) {
            setError(`Enter a whole number from 1 to ${MAX_SCORE_ADJUSTMENT.toLocaleString()}.`);
            return;
          }
          if (
            !Number.isSafeInteger(player.score + delta) ||
            (team && !Number.isSafeInteger(state.teamScores[team] + delta))
          ) {
            setError("That adjustment would exceed the score limit.");
            return;
          }
          if (send(result.data)) onClose();
        }}
      >
        <p className="community-editor-note">Change {player.name}’s score for this session.</p>
        <div className="score-direction" role="group" aria-label="Adjustment type">
          {([1, -1] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={direction === value}
              disabled={!connected}
              onClick={() => {
                setDirection(value);
                setError("");
              }}
            >
              {value === 1 ? "+ Add" : "− Deduct"}
            </button>
          ))}
        </div>
        <label htmlFor="score-adjustment">Points</label>
        <input
          ref={initialFocus}
          id="score-adjustment"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SCORE_ADJUSTMENT}
          step={1}
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError("");
          }}
          disabled={!connected}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "score-adjustment-error" : "score-adjustment-note"}
        />
        {error && (
          <p id="score-adjustment-error" className="team-name-error" role="alert">
            {error}
          </p>
        )}
        <div className="score-preview" aria-live="polite" aria-atomic="true">
          <span>{player.name}</span>
          <strong>
            {player.score} <span aria-label="becomes">→</span> {valid ? player.score + delta : "—"}
          </strong>
          {team && (
            <>
              <span>{teamName(state, team)}</span>
              <strong>
                {state.teamScores[team]} <span aria-label="becomes">→</span>{" "}
                {valid ? state.teamScores[team] + delta : "—"}
              </strong>
            </>
          )}
        </div>
        <p id="score-adjustment-note" className="community-editor-note">
          {team ? "The same adjustment applies to their current team. " : ""}
          Deductions can take a score below zero.
        </p>
        <div className="community-editor-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!connected}>
            {label}
          </button>
        </div>
      </form>
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
