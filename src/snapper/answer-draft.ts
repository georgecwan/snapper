import { ANSWER_DRAFT_INTERVAL_MS, type AnswerDraftMessage, type SessionView } from "./protocol.ts";

/** A draft belongs to an attempt, not merely to its question or player. */
export function matchesAnswerDraft(view: SessionView | null, draft: AnswerDraftMessage): boolean {
  return Boolean(
    view &&
    view.sessionId === draft.sessionId &&
    view.question?.id === draft.questionId &&
    view.phase === "answering" &&
    view.answerWindowId === draft.answerWindowId,
  );
}

/** Send the first edit promptly, then coalesce edits without delaying submission. */
export class AnswerDraftSender {
  private pending: AnswerDraftMessage | null = null;
  private last: AnswerDraftMessage | null = null;
  private lastSentAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private send: (draft: AnswerDraftMessage) => boolean;

  constructor(send: (draft: AnswerDraftMessage) => boolean) {
    this.send = send;
  }

  update(draft: AnswerDraftMessage): void {
    if (
      this.last &&
      (this.last.sessionId !== draft.sessionId || this.last.answerWindowId !== draft.answerWindowId)
    )
      this.cancel();
    this.pending = draft;
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastSentAt + ANSWER_DRAFT_INTERVAL_MS - Date.now());
    if (wait === 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.timer = null;
    const draft = this.pending;
    this.pending = null;
    if (!draft) return;
    if (
      this.last?.sessionId === draft.sessionId &&
      this.last.answerWindowId === draft.answerWindowId &&
      this.last.text === draft.text
    )
      return;
    if (this.send(draft)) {
      this.last = draft;
      this.lastSentAt = Date.now();
    }
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = this.last = null;
    this.lastSentAt = -Infinity;
  }
}
