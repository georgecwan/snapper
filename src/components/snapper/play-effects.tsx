import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  REACTIONS,
  REACTION_COOLDOWN_MS,
  type GameAction,
  type Reaction,
  type SessionView,
} from "@/snapper/protocol";
import { playerAvatar, playerColor } from "@/snapper/identity";
import { formatReminder, leadChangeText, scoringFeedback } from "@/snapper/play-feedback";
import "./play-effects.css";

export function ScoringMoment({ state, connected }: { state: SessionView; connected: boolean }) {
  const feedback = scoringFeedback(state);
  const questionId = state.question?.id ?? null;
  const eventKey = feedback ? `${questionId}:${feedback.attemptId}:${feedback.points}` : null;
  const previous = useRef<{
    sessionId: string;
    questionId: string | null;
    eventKey: string | null;
    connected: boolean;
  } | null>(null);
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const points = feedback?.points ?? 0;
  useEffect(() => {
    const before = previous.current;
    previous.current = { sessionId: state.sessionId, questionId, eventKey, connected };
    if (
      !connected ||
      !before?.connected ||
      before.sessionId !== state.sessionId ||
      before.questionId !== questionId ||
      !eventKey ||
      !points ||
      before.eventKey === eventKey
    ) {
      setCelebrating(null);
      return;
    }
    setCelebrating(eventKey);
    const timer = setTimeout(() => setCelebrating(null), 1400);
    return () => clearTimeout(timer);
  }, [connected, eventKey, points, questionId, state.sessionId]);
  if (!feedback) return null;
  const player = state.players.find((entry) => entry.id === feedback.playerId);
  const animated = connected && celebrating === eventKey;
  return (
    <div
      className={`play-scoring-moment${animated ? " play-scoring-pop" : ""}`}
      role="status"
      aria-live={animated ? "polite" : "off"}
    >
      {animated && (
        <span className="play-confetti" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <i key={index} style={{ "--piece": index } as CSSProperties} />
          ))}
        </span>
      )}
      <span
        className={`play-winner-avatar avatar-${playerColor(feedback.playerId)}`}
        aria-hidden="true"
      >
        {playerAvatar(player ?? { id: feedback.playerId })}
      </span>
      <span className="play-winner-copy">
        <strong>{feedback.name}</strong>
        <span>
          {feedback.corrected ? "Correct · ruling updated" : "Correct answer"}
          {feedback.leadChange && (
            <span className="play-lead-change">{leadChangeText(state, feedback.leadChange)}</span>
          )}
        </span>
      </span>
      {feedback.points > 0 && (
        <span className="play-earned-points" aria-label={`${feedback.points} points awarded`}>
          +{feedback.points}
        </span>
      )}
    </div>
  );
}

const reactionLabels: Record<Reaction, string> = {
  "😂": "Laugh",
  "👏": "Applaud",
  "😮": "Surprised",
  "💀": "Skull",
};

export function Reactions({
  state,
  send,
  connected,
  now,
}: {
  state: SessionView;
  send: (action: GameAction) => boolean;
  connected: boolean;
  now: number;
}) {
  const [pendingUntil, setPendingUntil] = useState(0);
  const reactions = state.reactions ?? [];
  const self = state.players.find((player) => player.id === state.selfId);
  const questionId = state.question?.id;
  const ownLatest = reactions.reduce(
    (latest, reaction) =>
      reaction.playerId === state.selfId ? Math.max(latest, reaction.at) : latest,
    -Infinity,
  );
  const cooldownUntil = Math.max(
    state.reactionReadyAt ?? 0,
    ownLatest + REACTION_COOLDOWN_MS,
    pendingUntil,
  );
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const disabled = !connected || !self?.connected || self.removed || cooldown > 0;
  const recent = reactions.filter((reaction) => reaction.at >= now - 6000).slice(-3);
  if (state.phase !== "reveal" || !questionId) return null;
  return (
    <section className="play-reactions" aria-label="Reactions to this answer">
      <div className="play-reactions-bar">
        <span className="play-reactions-label">React</span>
        <div className="play-reaction-buttons">
          {REACTIONS.map((emoji) => {
            const count = reactions.filter((reaction) => reaction.emoji === emoji).length;
            return (
              <button
                key={emoji}
                type="button"
                disabled={disabled}
                aria-label={`${reactionLabels[emoji]}${count ? `, ${count} ${count === 1 ? "reaction" : "reactions"}` : ""}${cooldown ? `, ready in ${cooldown} seconds` : ""}`}
                title={cooldown ? `Ready in ${cooldown}s` : reactionLabels[emoji]}
                onClick={() => {
                  if (!disabled && send({ type: "react", emoji }))
                    setPendingUntil(now + REACTION_COOLDOWN_MS);
                }}
              >
                <span aria-hidden="true">{emoji}</span>
                <small aria-hidden="true">{count || ""}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="play-recent-reactions" aria-live="polite" aria-atomic="false">
        {recent.map((reaction) => (
          <span
            key={reaction.id}
            className="play-reaction-pill"
            title={`${reaction.name}: ${reactionLabels[reaction.emoji]}`}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span>{reaction.name}</span>
            <span className="sr-only">reacted: {reactionLabels[reaction.emoji]}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

export function FormatCue({ state }: { state: SessionView }) {
  const questionId = state.question?.id ?? null;
  const previous = useRef(questionId);
  const [visible, setVisible] = useState<string | null>(null);
  useEffect(() => {
    if (questionId === previous.current) return;
    previous.current = questionId;
    setVisible(questionId);
    const timer = setTimeout(() => setVisible(null), 3200);
    return () => clearTimeout(timer);
  }, [questionId]);
  const reminder = formatReminder(state);
  if (!reminder || !questionId || visible !== questionId || state.phase === "reveal") return null;
  return (
    <div className="play-format-cue" role="status">
      <span aria-hidden="true">✦</span>
      <strong>{reminder.label}</strong>
      <span>{reminder.points}</span>
    </div>
  );
}
