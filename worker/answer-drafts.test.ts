import test from "node:test";
import assert from "node:assert/strict";
import { AnswerDrafts } from "./answer-drafts.ts";
import type { AnswerDraftMessage } from "../src/snapper/protocol.ts";

type DraftView = Parameters<AnswerDrafts["accept"]>[1];
const sender = { playerId: "alice", connectionId: "alice-tab-1" };
const view = (): DraftView => ({
  sessionId: "session-1",
  phase: "answering",
  question: {
    id: "question-1",
    text: "This progressive clue is still incomplete",
    category: "Science",
    format: "tossup",
    readingComplete: false,
    answer: null,
    provenance: null,
    clueNumber: null,
    sequenceLength: null,
  },
  answerWindowId: "question-1:answer:0:alice",
  answererId: "alice",
  players: [
    {
      id: "alice",
      name: "Alice",
      team: null,
      score: 10,
      role: "player",
      connected: true,
      owner: false,
      moderator: false,
    },
  ],
  pausedReasons: [],
  challenge: null,
  deadline: 9000,
});
const frame = (text = "grav"): AnswerDraftMessage => ({
  type: "answer-draft",
  sessionId: "session-1",
  questionId: "question-1",
  answerWindowId: "question-1:answer:0:alice",
  text,
});
const accept = (drafts: AnswerDrafts, text = "grav", state = view(), now = 1000) =>
  drafts.accept(frame(text), state, sender, sender.connectionId, now);

test("drafts relay only typed text without changing the game projection or revealing content", () => {
  const drafts = new AnswerDrafts();
  const state = view();
  const before = structuredClone(state);
  const input = frame("  gravity ");
  assert.deepEqual(drafts.accept(input, state, sender, sender.connectionId, 1000), input);
  assert.deepEqual(state, before);
  assert.equal(drafts.text(state, sender.connectionId, 1001), "  gravity ");
  assert.equal(accept(drafts, "  gravity "), null, "unchanged text does not create another frame");
  assert.equal(new AnswerDrafts().text(state, sender.connectionId, 1001), "");
});

test("empty text erases a draft and new observers receive its latest value", () => {
  const drafts = new AnswerDrafts();
  accept(drafts, "gravity");
  assert.equal(drafts.text(view(), sender.connectionId, 1100), "gravity");
  assert.deepEqual(accept(drafts, ""), frame(""));
  assert.equal(drafts.text(view(), sender.connectionId, 1100), "");
});

test("other players and replaced connections cannot publish or clear the active draft", () => {
  const drafts = new AnswerDrafts();
  accept(drafts);
  for (const impostor of [
    { playerId: "bob", connectionId: "bob-tab" },
    { playerId: "alice", connectionId: "alice-replaced-tab" },
  ]) {
    assert.equal(drafts.accept(frame("spoof"), view(), impostor, sender.connectionId, 1100), null);
    assert.equal(drafts.text(view(), sender.connectionId, 1100), "grav");
  }
});

test("invalid and stale frames cannot overwrite a valid current draft", () => {
  const drafts = new AnswerDrafts();
  accept(drafts);
  for (const input of [
    { ...frame(), sessionId: "ended-session" },
    { ...frame(), questionId: "previous-question" },
    { ...frame(), answerWindowId: "previous-attempt" },
    { ...frame(), text: "x".repeat(501) },
    { ...frame(), text: null },
    { ...frame(), playerId: "alice" },
    { type: "answer-draft" },
    null,
  ]) {
    assert.equal(drafts.accept(input, view(), sender, sender.connectionId, 1100), null);
    assert.equal(drafts.text(view(), sender.connectionId, 1100), "grav");
  }
  assert.ok(accept(drafts, "x".repeat(500)));
});

test("pause and challenge freeze the draft even after the original deadline, then resume it", () => {
  for (const held of [
    { ...view(), pausedReasons: ["Paused by a moderator"] },
    { ...view(), challenge: { playerId: "alice", name: "Alice" } },
  ]) {
    const drafts = new AnswerDrafts();
    accept(drafts);
    assert.equal(accept(drafts, "changed while paused", held, 20_000), null);
    assert.equal(drafts.text(held, sender.connectionId, 20_000), "grav");
    const resumed = { ...view(), deadline: 25_000 };
    assert.equal(drafts.text(resumed, sender.connectionId, 20_000), "grav");
    assert.deepEqual(accept(drafts, "gravity", resumed, 20_000), frame("gravity"));
  }
});

test("the actual deadline rejects late text without advancing or judging the game", () => {
  for (const now of [9000, 9001]) {
    const drafts = new AnswerDrafts();
    const state = view();
    const before = structuredClone(state);
    accept(drafts);
    assert.equal(accept(drafts, "too late", state, now), null);
    assert.equal(drafts.text(state, sender.connectionId, now), "");
    assert.deepEqual(state, before);
  }
  assert.ok(accept(new AnswerDrafts(), "just in time", view(), 8999));
});

test("question, attempt, phase and seat changes permanently discard previous drafts", () => {
  const alterations: Array<(state: DraftView) => void> = [
    (state) => {
      state.sessionId = "session-2";
    },
    (state) => {
      state.question!.id = "question-2";
    },
    (state) => {
      state.answerWindowId = "question-1:answer:1:alice";
    },
    (state) => {
      state.answererId = "bob";
    },
    (state) => {
      state.phase = "reading";
    },
    (state) => {
      state.phase = "reveal";
    },
    (state) => {
      state.phase = "waiting";
    },
    (state) => {
      state.players[0].connected = false;
    },
    (state) => {
      state.players[0].role = "spectator";
    },
    (state) => {
      state.players[0].removed = true;
    },
    (state) => {
      state.players = [];
    },
    (state) => {
      state.deadline = null;
    },
  ];
  for (const alter of alterations) {
    const drafts = new AnswerDrafts();
    accept(drafts);
    const changed = view();
    alter(changed);
    assert.equal(drafts.text(changed, sender.connectionId, 1100), "");
    assert.equal(drafts.text(view(), sender.connectionId, 1101), "", "never restore old text");
    assert.equal(accept(drafts, "stale", changed, 1102), null);
  }
});

test("takeover, disconnect and session cleanup do not hand drafts to a new connection", () => {
  for (const connection of [undefined, "alice-tab-2"]) {
    const drafts = new AnswerDrafts();
    accept(drafts);
    assert.equal(drafts.text(view(), connection, 1100), "");
    assert.equal(drafts.text(view(), sender.connectionId, 1101), "");
  }
  const drafts = new AnswerDrafts();
  accept(drafts);
  drafts.clear("bob");
  assert.equal(drafts.text(view(), sender.connectionId, 1100), "grav");
  drafts.clear("alice");
  assert.equal(drafts.text(view(), sender.connectionId, 1100), "");
  accept(drafts);
  drafts.clear();
  assert.equal(drafts.text(view(), sender.connectionId, 1100), "");
});

test("draft quotas allow normal typing, bound bursts and isolate each connection", () => {
  const drafts = new AnswerDrafts();
  const connection = {};
  for (let now = 1000; now <= 10_000; now += 200)
    assert.equal(drafts.rate(connection, now), "allow");
  const burst = {};
  for (let i = 0; i < 5; i++) assert.equal(drafts.rate(burst, 1000), "allow");
  assert.equal(drafts.rate(burst, 1000), "drop");
  assert.equal(drafts.rate({}, 1000), "allow");
  assert.equal(drafts.rate(burst, 1199), "drop");
  assert.equal(drafts.rate(burst, 1200), "allow");
  for (let i = 0; i < 60; i++) drafts.rate(burst, 1200);
  assert.equal(drafts.rate(burst, 1200), "close");
  assert.equal(drafts.rate(burst, 6200), "allow");
});
