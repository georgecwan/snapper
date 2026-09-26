import test from "node:test";
import assert from "node:assert/strict";
import { createSession, publicView } from "./engine.ts";
import { DEFAULT_CONFIG, type AttemptView, type SessionView } from "./protocol.ts";
import { GameSoundDetector, SOUND_NOTES } from "./sounds.ts";

function snapshot(changes: Partial<SessionView> = {}): SessionView {
  const base = publicView(
    createSession(
      "sound-session",
      {
        id: "me",
        name: "Me",
        role: "player",
        team: null,
        score: 0,
        connected: true,
        owner: true,
        moderator: true,
      },
      DEFAULT_CONFIG,
      0,
    ),
    "me",
    0,
  );
  return {
    ...base,
    phase: "reading",
    revision: 1,
    question: {
      id: "question-1",
      text: "A question",
      category: "Science",
      format: "snapper",
      readingComplete: false,
      answer: null,
      provenance: null,
      clueNumber: null,
      sequenceLength: null,
    },
    ...changes,
  };
}
function attempt(
  id: string,
  verdict: AttemptView["verdict"],
  changes: Partial<AttemptView> = {},
): AttemptView {
  return {
    id,
    playerId: "me",
    name: "Me",
    answer: "Answer",
    verdict,
    points: verdict === "accept" ? 10 : 0,
    corrected: false,
    ...changes,
  };
}
const buzzing = (answererId = "me", answerWindowId = "window-1") =>
  snapshot({
    phase: "answering",
    answererId,
    answerWindowId,
    deadline: 8000,
  });

test("initial snapshots and duplicate, draft, chat or reading updates are silent", () => {
  const detector = new GameSoundDetector();
  const state = buzzing();
  assert.equal(detector.observe(state, true, true), null);
  assert.equal(detector.observe(state, true, true), null);
  assert.equal(detector.observe({ ...state, answerDraft: "Par" }, true, true), null);
  assert.equal(
    detector.observe(
      {
        ...state,
        revision: 2,
        chat: [{ id: "chat", playerId: "me", name: "Me", text: "Hi", at: 1 }],
      },
      true,
      true,
    ),
    null,
  );
  assert.equal(
    detector.observe(
      {
        ...state,
        revision: 2,
        question: { ...state.question!, text: "A question with another word" },
      },
      true,
      true,
    ),
    null,
  );
});

test("confirmed own and other-player buzzes have distinct cues", () => {
  const mine = new GameSoundDetector();
  mine.observe(snapshot(), true, true);
  assert.equal(mine.observe(buzzing(), true, true), "own-buzz");
  assert.equal(mine.observe(buzzing(), true, true), null);
  const other = new GameSoundDetector();
  other.observe(snapshot(), true, true);
  assert.equal(other.observe(buzzing("friend"), true, true), "other-buzz");
});

test("clarification sounds once and does not become a second buzz for the same answerer", () => {
  const detector = new GameSoundDetector();
  detector.observe(buzzing(), true, true);
  const prompted = { ...buzzing("me", "window-2"), attempts: [attempt("first", "prompt")] };
  assert.equal(detector.observe(prompted, true, true), "prompt");
  assert.equal(detector.observe({ ...prompted, deadline: 16000 }, true, true), null);
  const accepted = {
    ...prompted,
    phase: "reveal" as const,
    answerWindowId: null,
    answererId: null,
    attempts: [...prompted.attempts, attempt("second", "accept")],
  };
  assert.equal(detector.observe(accepted, true, true), "correct");
  assert.equal(detector.observe(accepted, true, true), null);
});

test("a later same-player answer window sounds even if no different answerer was observed", () => {
  const detector = new GameSoundDetector();
  const first = buzzing();
  detector.observe(first, true, true);
  // Intermediate frames may be batched by React; window identity still changes.
  assert.equal(
    detector.observe({ ...first, answerWindowId: "later-window" }, true, true),
    "own-buzz",
  );
  assert.equal(detector.observe({ ...first, answerWindowId: "later-window" }, true, true), null);
});

test("ruling corrections sound on verdict changes, without replaying point resets or unchanged rulings", () => {
  const detector = new GameSoundDetector();
  const rejected = snapshot({ attempts: [attempt("first", "reject")], phase: "reveal" });
  detector.observe(rejected, true, true);
  const corrected = { ...rejected, attempts: [attempt("first", "accept", { corrected: true })] };
  assert.equal(detector.observe(corrected, true, true), "correct");
  assert.equal(
    detector.observe(
      { ...corrected, attempts: [attempt("first", "accept", { corrected: true, points: 0 })] },
      true,
      true,
    ),
    null,
  );
  const reversed = { ...corrected, attempts: [attempt("first", "reject", { corrected: true })] };
  assert.equal(detector.observe(reversed, true, true), "incorrect");
  assert.equal(detector.observe(reversed, true, true), null);
});

test("only a newly observed empty rejected attempt means an answer timeout", () => {
  for (const [answer, expected] of [
    ["Wrong answer", "incorrect"],
    ["", "timeout"],
  ] as const) {
    const detector = new GameSoundDetector();
    detector.observe(buzzing(), true, true);
    const result = snapshot({ attempts: [attempt("first", "reject", { answer })] });
    assert.equal(detector.observe(result, true, true), expected);
  }
  const detector = new GameSoundDetector();
  detector.observe(buzzing(), true, true);
  assert.equal(
    detector.observe(snapshot({ phase: "reveal", serverTime: 9000 }), true, true),
    null,
    "skipping/revealing is not a timeout",
  );
  const old = snapshot({
    phase: "reveal",
    attempts: [attempt("old", "accept", { answer: "", corrected: true })],
  });
  detector.observe(old, true, true);
  assert.equal(
    detector.observe(
      { ...old, attempts: [attempt("old", "reject", { answer: "", corrected: true })] },
      true,
      true,
    ),
    "incorrect",
    "correcting an old timeout is a ruling change",
  );
});

test("new questions chime once, while automatic assigned turns do not impersonate a buzz", () => {
  const detector = new GameSoundDetector();
  detector.observe(snapshot({ question: null, phase: "waiting" }), true, true);
  assert.equal(detector.observe(snapshot(), true, true), "question");
  assert.equal(detector.observe(snapshot(), true, true), null);
  const assigned = snapshot();
  assigned.question!.format = "assigned";
  detector.observe(assigned, true, true);
  assert.equal(
    detector.observe(
      { ...assigned, phase: "answering", answererId: "me", answerWindowId: "assigned-window" },
      true,
      true,
    ),
    null,
  );
  const next = snapshot();
  next.question!.id = "question-2";
  assert.equal(detector.observe(next, true, true), "question");
  assert.equal(
    detector.observe(
      { ...next, phase: "reading", question: { ...next.question!, clueNumber: 2 } },
      true,
      true,
    ),
    null,
  );
});

test("reconnecting, unmuting and unlocking baseline missed events instead of replaying them", () => {
  for (const reason of ["connection", "audio"] as const) {
    const detector = new GameSoundDetector();
    detector.observe(snapshot(), true, true);
    detector.observe(snapshot(), reason !== "connection", reason !== "audio");
    const missed = snapshot({
      phase: "reveal",
      attempts: [attempt("old-1", "prompt"), attempt("old-2", "accept")],
    });
    assert.equal(detector.observe(missed, true, true), null, reason);
    assert.equal(detector.observe(missed, true, true), null, reason);
    const next = snapshot();
    next.question!.id = "new-after-reconnect";
    assert.equal(detector.observe(next, true, true), "question", reason);
  }
  const detector = new GameSoundDetector();
  detector.observe(snapshot(), true, true);
  detector.reset();
  assert.equal(detector.observe(buzzing(), true, true), null);
});

test("batched events choose only the latest outcome and old revisions cannot rewind sound history", () => {
  const detector = new GameSoundDetector();
  detector.observe(buzzing(), true, true);
  const result = snapshot({
    revision: 10,
    phase: "reveal",
    attempts: [
      attempt("one", "prompt"),
      attempt("two", "reject"),
      attempt("three", "accept", { playerId: "friend" }),
    ],
  });
  assert.equal(detector.observe(result, true, true), "correct");
  assert.equal(detector.observe(snapshot({ revision: 2 }), true, true), null);
  assert.equal(detector.observe(result, true, true), null);
  assert.equal(detector.observe({ ...result, sessionId: "different-session" }, true, true), null);
});

test("all cues are distinct short motifs with bounded quiet levels", () => {
  assert.equal(new Set(Object.values(SOUND_NOTES).map((notes) => JSON.stringify(notes))).size, 7);
  for (const notes of Object.values(SOUND_NOTES)) {
    assert.ok(notes.length >= 1 && notes.length <= 4);
    assert.ok(Math.max(...notes.map((note) => note.at + note.duration)) < 0.5);
    assert.ok(notes.reduce((sum, note) => sum + note.volume, 0) < 0.1);
    for (const note of notes) {
      assert.ok(note.frequency > 0 && Number.isFinite(note.frequency));
      assert.ok(note.duration >= 0.025 && note.volume > 0);
    }
  }
});
