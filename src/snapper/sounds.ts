import type { AttemptView, SessionView } from "./protocol.ts";

export type GameSound =
  "own-buzz" | "other-buzz" | "correct" | "incorrect" | "prompt" | "timeout" | "question";

interface SoundSnapshot {
  sessionId: string;
  selfId: string;
  revision: number;
  questionId: string | null;
  answerWindowId: string | null;
  attempts: Array<Pick<AttemptView, "id" | "verdict">>;
  connected: boolean;
  enabled: boolean;
}

/** Only the newest observed server event makes a sound; never queue catch-up audio. */
export class GameSoundDetector {
  private previous: SoundSnapshot | null = null;

  reset(): void {
    this.previous = null;
  }

  observe(state: SessionView | null, connected: boolean, enabled: boolean): GameSound | null {
    if (!state) {
      this.reset();
      return null;
    }
    const previous = this.previous;
    if (previous?.sessionId === state.sessionId && state.revision < previous.revision) return null;
    this.previous = {
      sessionId: state.sessionId,
      selfId: state.selfId,
      revision: state.revision,
      questionId: state.question?.id ?? null,
      answerWindowId: state.answerWindowId,
      attempts: state.attempts.map(({ id, verdict }) => ({ id, verdict })),
      connected,
      enabled,
    };
    if (
      !previous ||
      !connected ||
      !previous.connected ||
      !enabled ||
      !previous.enabled ||
      previous.sessionId !== state.sessionId ||
      previous.selfId !== state.selfId ||
      !state.question
    )
      return null;
    if (previous.questionId !== state.question.id)
      return state.phase === "reading" || state.phase === "answering" ? "question" : null;

    const priorAttempts = new Map(
      previous.attempts.map((attempt) => [attempt.id, attempt.verdict]),
    );
    // A correction may replace an earlier ruling without creating a new attempt.
    // Point recalculations, score resets and unchanged corrected verdicts are silent.
    const latest = [...state.attempts].reverse().find((attempt) => {
      const verdict = priorAttempts.get(attempt.id);
      return verdict === undefined || (attempt.corrected && verdict !== attempt.verdict);
    });
    if (latest) {
      if (latest.verdict === "prompt") return "prompt";
      if (latest.verdict === "accept") return "correct";
      // Submitted answers are required to be nonempty. Only the server creates
      // empty rejected attempts for an expired answer window; don't infer this
      // from a client clock or confuse a corrected old ruling with a new timeout.
      return !priorAttempts.has(latest.id) && !latest.answer.trim() ? "timeout" : "incorrect";
    }
    if (
      state.phase === "answering" &&
      state.answererId &&
      state.answerWindowId &&
      state.answerWindowId !== previous.answerWindowId &&
      state.question.format !== "assigned"
    )
      return state.answererId === state.selfId ? "own-buzz" : "other-buzz";
    return null;
  }
}

export interface SoundNote {
  at: number;
  duration: number;
  frequency: number;
  endFrequency?: number;
  wave: "sine" | "triangle";
  volume: number;
}

/** Short, low-volume motifs differ in rhythm and timbre as well as pitch. */
export const SOUND_NOTES: Record<GameSound, readonly SoundNote[]> = {
  "own-buzz": [
    { at: 0, duration: 0.07, frequency: 330, endFrequency: 440, wave: "triangle", volume: 0.038 },
    { at: 0.085, duration: 0.12, frequency: 660, wave: "triangle", volume: 0.033 },
  ],
  "other-buzz": [
    { at: 0, duration: 0.15, frequency: 196, endFrequency: 147, wave: "triangle", volume: 0.028 },
    { at: 0, duration: 0.09, frequency: 294, wave: "sine", volume: 0.012 },
  ],
  correct: [
    { at: 0, duration: 0.15, frequency: 523.25, wave: "sine", volume: 0.028 },
    { at: 0.085, duration: 0.15, frequency: 659.25, wave: "sine", volume: 0.027 },
    { at: 0.17, duration: 0.2, frequency: 783.99, wave: "sine", volume: 0.025 },
  ],
  incorrect: [
    {
      at: 0,
      duration: 0.14,
      frequency: 196,
      endFrequency: 174.61,
      wave: "triangle",
      volume: 0.025,
    },
    {
      at: 0.13,
      duration: 0.18,
      frequency: 146.83,
      endFrequency: 130.81,
      wave: "triangle",
      volume: 0.025,
    },
  ],
  prompt: [
    { at: 0, duration: 0.09, frequency: 523.25, wave: "sine", volume: 0.024 },
    { at: 0.15, duration: 0.17, frequency: 783.99, wave: "sine", volume: 0.024 },
  ],
  timeout: [
    { at: 0, duration: 0.045, frequency: 110, wave: "triangle", volume: 0.027 },
    { at: 0.09, duration: 0.045, frequency: 110, wave: "triangle", volume: 0.024 },
    { at: 0.18, duration: 0.06, frequency: 82.41, wave: "triangle", volume: 0.023 },
  ],
  question: [
    { at: 0, duration: 0.12, frequency: 392, wave: "sine", volume: 0.014 },
    { at: 0.035, duration: 0.14, frequency: 784, wave: "sine", volume: 0.011 },
  ],
};
