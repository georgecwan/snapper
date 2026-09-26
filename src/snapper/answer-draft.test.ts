import test from "node:test";
import assert from "node:assert/strict";
import { AnswerDraftSender, matchesAnswerDraft } from "./answer-draft.ts";
import { createSession, publicView, startBlock, tick, transition } from "./engine.ts";
import { DEFAULT_CONFIG, answerDraftSchema, type AnswerDraftMessage } from "./protocol.ts";

const draft = (text: string, answerWindowId = "attempt-1"): AnswerDraftMessage => ({
  type: "answer-draft",
  sessionId: "session",
  questionId: "question",
  answerWindowId,
  text,
});

test("draft typing sends promptly, coalesces rapid edits, and shares deletion", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const sent: AnswerDraftMessage[] = [];
  const sender = new AnswerDraftSender((message) => {
    sent.push(message);
    return true;
  });
  sender.update(draft("b"));
  t.mock.timers.tick(50);
  sender.update(draft("bl"));
  t.mock.timers.tick(50);
  sender.update(draft("blue"));
  assert.deepEqual(
    sent.map((message) => message.text),
    ["b"],
  );
  t.mock.timers.tick(100);
  assert.deepEqual(
    sent.map((message) => message.text),
    ["b", "blue"],
  );
  sender.update(draft("blue"));
  t.mock.timers.tick(200);
  assert.equal(sent.length, 2, "unchanged text does not spend another message");
  sender.update(draft(""));
  assert.equal(sent.at(-1)?.text, "", "deleting a guess clears the public draft");
});

test("submission, disconnect or pause can cancel a queued draft without sending it", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const sent: AnswerDraftMessage[] = [];
  const sender = new AnswerDraftSender((message) => {
    sent.push(message);
    return true;
  });
  sender.update(draft("first"));
  sender.update(draft("unsent edit"));
  sender.cancel();
  t.mock.timers.tick(1000);
  assert.deepEqual(
    sent.map((message) => message.text),
    ["first"],
  );
  sender.update(draft("first"));
  assert.equal(sent.length, 2, "resuming a pause can republish a still-current draft");
});

test("a new answer window replaces a pending old draft and rechecks before sending", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const sent: AnswerDraftMessage[] = [];
  let allowed = true;
  const sender = new AnswerDraftSender((message) => {
    if (!allowed) return false;
    sent.push(message);
    return true;
  });
  sender.update(draft("old"));
  sender.update(draft("old pending"));
  sender.update(draft("new", "attempt-2"));
  t.mock.timers.tick(200);
  assert.deepEqual(
    sent.map((message) => message.text),
    ["old", "new"],
  );
  sender.update(draft("new edit", "attempt-2"));
  allowed = false;
  sender.update(draft("after losing the turn", "attempt-2"));
  t.mock.timers.tick(200);
  assert.deepEqual(
    sent.map((message) => message.text),
    ["old", "new", "new edit"],
  );
});

test("only the current answer window accepts a frame; clarification gets a new identity", () => {
  let state = createSession(
    "session",
    {
      id: "host",
      name: "Host",
      team: null,
      score: 0,
      role: "player",
      connected: true,
      owner: true,
      moderator: true,
    },
    { ...DEFAULT_CONFIG, shortProgressive: false, autoAdvance: false },
    0,
  );
  state = transition(state, "host", { type: "start" }, 0).state;
  state = startBlock(
    state,
    {
      id: "bundle",
      title: "Test",
      format: "snapper",
      atoms: [
        {
          id: "atom",
          text: "Name this person.",
          category: "History",
          difficulty: "medium",
          language: "en",
          answer: {
            canonical: "Alexander Hamilton",
            aliases: [],
            promptAliases: ["Hamilton"],
          },
          provenance: { label: "Test", license: "CC0" },
        },
      ],
    },
    0,
  );
  state = transition(state, "host", { type: "buzz" }, 1).state;
  const view = publicView(state, "host", 1);
  const message = {
    ...draft("Ham"),
    questionId: view.question!.id,
    answerWindowId: view.answerWindowId!,
  };
  assert.ok(matchesAnswerDraft(view, message));
  assert.equal(matchesAnswerDraft(null, message), false);
  for (const changed of [{ sessionId: "old" }, { questionId: "old" }, { answerWindowId: "old" }])
    assert.equal(matchesAnswerDraft(view, { ...message, ...changed }), false);
  state = transition(state, "host", { type: "pause" }, 2).state;
  assert.equal(publicView(state, "host", 2).answerWindowId, view.answerWindowId);
  state = transition(state, "host", { type: "resume" }, 3).state;
  state = transition(state, "host", { type: "answer", text: "Hamilton" }, 4).state;
  const clarification = publicView(state, "host", 4);
  assert.equal(clarification.phase, "answering");
  assert.notEqual(clarification.answerWindowId, view.answerWindowId);
  assert.equal(matchesAnswerDraft(clarification, message), false);
  state = tick(state, clarification.deadline!);
  const ended = publicView(state, "host", clarification.deadline!);
  assert.equal(ended.answerWindowId, null);
  assert.equal(ended.answerDraft, "");
  assert.equal(matchesAnswerDraft(ended, message), false);
});

test("draft schema accepts empty edits but caps length and rejects identity spoof fields", () => {
  assert.ok(answerDraftSchema.safeParse(draft("")).success);
  assert.ok(answerDraftSchema.safeParse(draft("x".repeat(500))).success);
  assert.equal(answerDraftSchema.safeParse(draft("x".repeat(501))).success, false);
  assert.equal(
    answerDraftSchema.safeParse({ ...draft("x"), playerId: "someone-else" }).success,
    false,
  );
});
