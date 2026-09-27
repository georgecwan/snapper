import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SessionView } from "@/snapper/protocol";
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
