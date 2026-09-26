import test from "node:test";
import assert from "node:assert/strict";
import {
  addParticipant,
  createSession,
  nextDeadline,
  publicView,
  startBlock,
  transition,
  type Session,
} from "./engine.ts";
import { DEFAULT_CONFIG, type GameAction, type PlayerView, type QuestionAtom } from "./protocol.ts";

const canonical = "January 1, 1970";
const player = (id: string, spectator = false): PlayerView => ({
  id,
  name: id,
  role: spectator ? "spectator" : "player",
  connected: true,
  team: null,
  owner: id === "host",
  moderator: id === "host",
  score: 0,
});
function act(state: Session, id: string, action: GameAction, now: number): Session {
  const result = transition(state, id, action, now);
  assert.equal(result.error, undefined);
  return result.state;
}
function answering(rejectYear = false): Session {
  let state = createSession(
    "date-clarification",
    player("host"),
    {
      ...structuredClone(DEFAULT_CONFIG),
      formats: ["tossup"],
      answerMs: 3000,
      autoAdvance: false,
      negs: true,
    },
    0,
  );
  state = addParticipant(state, player("guesser"), 0);
  state = addParticipant(state, player("observer", true), 0);
  state = act(state, "host", { type: "start" }, 0);
  const question: QuestionAtom = {
    id: "private-date-source",
    text: "This reference instant is used to count elapsed seconds. Give the full date of the Unix epoch.",
    category: "Science",
    difficulty: "medium",
    language: "en",
    answer: {
      canonical,
      aliases: ["PRIVATE ACCEPTED KEY"],
      rejects: rejectYear ? ["1970"] : ["PRIVATE REJECTED KEY"],
    },
    provenance: { label: "Test fixture", license: "CC0" },
  };
  state = startBlock(
    state,
    { id: "date-block", title: "Date question", format: "tossup", atoms: [question] },
    0,
  );
  assert.ok(state.block);
  return act(state, "guesser", { type: "buzz" }, 1000);
}

test("an inferred date prompt preserves the guesser's turn without scoring and grants a new fixed window", () => {
  let state = answering();
  const first = publicView(state, "guesser", 1000);
  assert.equal(first.deadline, 4000, "the configured initial answer window is three seconds");
  state = act(state, "guesser", { type: "answer", text: "1970" }, 2000);
  const prompted = publicView(state, "guesser", 2000);
  assert.equal(prompted.phase, "answering");
  assert.equal(prompted.answererId, "guesser");
  assert.equal(prompted.canAnswer, true);
  assert.equal(prompted.deadline, 10_000, "clarification always gets eight fresh seconds");
  assert.equal(nextDeadline(state), 10_000);
  assert.ok(prompted.answerWindowId);
  assert.notEqual(prompted.answerWindowId, first.answerWindowId);
  assert.deepEqual(
    prompted.attempts.map(({ answer, verdict, points }) => ({ answer, verdict, points })),
    [{ answer: "1970", verdict: "prompt", points: 0 }],
  );
  assert.ok(prompted.players.every((entry) => entry.score === 0));
  assert.deepEqual(prompted.teamScores, { A: 0, B: 0 });

  for (const id of ["host", "guesser", "observer"]) {
    const view = publicView(state, id, 2000);
    assert.equal(view.question!.answer, null);
    assert.equal(view.question!.provenance, null);
    assert.equal(view.canAnswer, id === "guesser");
    const snapshot = JSON.stringify(view);
    assert.ok(!snapshot.includes(canonical));
    assert.ok(!snapshot.includes("PRIVATE ACCEPTED KEY"));
    assert.ok(!snapshot.includes("PRIVATE REJECTED KEY"));
    assert.ok(!snapshot.includes("private-date-source"));
  }

  // This is after the original deadline but before the clarification expires.
  state = act(state, "guesser", { type: "answer", text: canonical }, 9000);
  const accepted = publicView(state, "host", 9000);
  assert.equal(accepted.phase, "reveal");
  assert.equal(accepted.answerWindowId, null);
  assert.equal(accepted.question!.answer, canonical);
  assert.deepEqual(
    accepted.attempts.map(({ verdict, points }) => ({ verdict, points })),
    [
      { verdict: "prompt", points: 0 },
      { verdict: "accept", points: DEFAULT_CONFIG.points.regular },
    ],
  );
  assert.equal(
    accepted.players.find((entry) => entry.id === "guesser")!.score,
    DEFAULT_CONFIG.points.regular,
  );
});

test("a second partial date is rejected and consumes the attempt without another clarification", () => {
  let state = answering();
  state = act(state, "guesser", { type: "answer", text: "1970" }, 2000);
  state = act(state, "guesser", { type: "answer", text: "1970" }, 3000);
  const view = publicView(state, "guesser", 3000);
  assert.equal(view.phase, "reading");
  assert.equal(view.answererId, null);
  assert.equal(view.answerWindowId, null);
  assert.equal(view.canAnswer, false);
  assert.equal(view.canBuzz, false);
  assert.equal(publicView(state, "host", 3000).canBuzz, true);
  assert.deepEqual(
    view.attempts.map(({ verdict, points }) => ({ verdict, points })),
    [
      { verdict: "prompt", points: 0 },
      { verdict: "reject", points: DEFAULT_CONFIG.points.penalty },
    ],
  );
  assert.equal(
    view.players.find((entry) => entry.id === "guesser")!.score,
    DEFAULT_CONFIG.points.penalty,
  );
  const late = transition(state, "guesser", { type: "answer", text: canonical }, 4000);
  assert.ok(late.error);
  assert.equal(late.state.question!.attempts.length, 2);
});

test("an authored reject for the year overrides inferred date clarification", () => {
  let state = answering(true);
  state = act(state, "guesser", { type: "answer", text: "1970" }, 2000);
  const view = publicView(state, "guesser", 2000);
  assert.equal(view.phase, "reading");
  assert.equal(view.answerWindowId, null);
  assert.equal(view.canAnswer, false);
  assert.deepEqual(
    view.attempts.map(({ verdict, points }) => ({ verdict, points })),
    [{ verdict: "reject", points: DEFAULT_CONFIG.points.penalty }],
  );
  assert.equal(view.question!.answer, null);
  assert.equal(publicView(state, "host", 2000).canBuzz, true);
});
