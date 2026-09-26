import {
  answerDraftSchema,
  type AnswerDraftMessage,
  type SessionView,
} from "../src/snapper/protocol.ts";

type DraftView = Pick<
  SessionView,
  | "sessionId"
  | "phase"
  | "question"
  | "answerWindowId"
  | "answererId"
  | "players"
  | "pausedReasons"
  | "challenge"
  | "deadline"
>;
interface DraftSender {
  playerId: string;
  connectionId: string;
}
interface Draft extends DraftSender {
  message: AnswerDraftMessage;
}
interface RateWindow {
  at: number;
  tokens: number;
  windowStart: number;
  count: number;
}

/** Transient presentation state: never include this in a session record or socket attachment. */
export class AnswerDrafts {
  private draft: Draft | null = null;
  private rates = new WeakMap<object, RateWindow>();

  /** Five updates/second with a small burst allowance, independent of game commands. */
  rate(connection: object, now: number): "allow" | "drop" | "close" {
    const state = this.rates.get(connection) ?? {
      at: now,
      tokens: 5,
      windowStart: now,
      count: 0,
    };
    if (now - state.windowStart >= 5000) {
      state.windowStart = now;
      state.count = 0;
    }
    state.count++;
    state.tokens = Math.min(5, state.tokens + Math.max(0, now - state.at) / 200);
    state.at = now;
    this.rates.set(connection, state);
    if (state.count > 60) return "close";
    if (state.tokens < 1) return "drop";
    state.tokens--;
    return "allow";
  }

  clear(playerId?: string): void {
    if (playerId === undefined || this.draft?.playerId === playerId) this.draft = null;
  }

  private matches(view: DraftView, sender: DraftSender, currentConnectionId: string | undefined) {
    return (
      view.phase === "answering" &&
      view.question !== null &&
      view.answerWindowId !== null &&
      view.answererId === sender.playerId &&
      currentConnectionId === sender.connectionId &&
      view.players.some(
        (player) =>
          player.id === sender.playerId &&
          player.connected &&
          player.role === "player" &&
          !player.removed,
      )
    );
  }

  /** Reconcile on every full projection so a changed attempt/seat cannot retain old text. */
  text(view: DraftView, currentConnectionId: string | undefined, now: number): string {
    const draft = this.draft;
    if (
      draft &&
      (!this.matches(view, draft, currentConnectionId) ||
        draft.message.sessionId !== view.sessionId ||
        draft.message.questionId !== view.question?.id ||
        draft.message.answerWindowId !== view.answerWindowId ||
        (!view.pausedReasons.length &&
          !view.challenge &&
          (view.deadline === null || now >= view.deadline)))
    )
      this.draft = null;
    return this.draft?.message.text ?? "";
  }

  accept(
    input: unknown,
    view: DraftView,
    sender: DraftSender,
    currentConnectionId: string | undefined,
    now: number,
  ): AnswerDraftMessage | null {
    // Invalid frames must not clear another player's valid draft. Reconciliation
    // uses the active answerer's connection, supplied separately from the sender.
    this.text(view, currentConnectionId, now);
    const parsed = answerDraftSchema.safeParse(input);
    if (
      !parsed.success ||
      !this.matches(view, sender, currentConnectionId) ||
      view.pausedReasons.length ||
      view.challenge ||
      view.deadline === null ||
      now >= view.deadline
    )
      return null;
    const message = parsed.data;
    if (
      message.sessionId !== view.sessionId ||
      message.questionId !== view.question?.id ||
      message.answerWindowId !== view.answerWindowId
    )
      return null;
    if (this.draft?.message.text === message.text) return null;
    this.draft = { ...sender, message };
    return { ...message };
  }
}
