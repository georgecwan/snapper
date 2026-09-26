import test from "node:test";
import assert from "node:assert/strict";
import { formatReminder, leadChangeText, scoringFeedback } from "./play-feedback.ts";
import {
  DEFAULT_CONFIG,
  DEFAULT_TEAM_NAMES,
  type AttemptView,
  type Format,
  type PlayerView,
  type SessionView,
} from "./protocol.ts";

function player(id: string, score: number, changes: Partial<PlayerView> = {}): PlayerView {
  return {
    id,
    name: id.toUpperCase(),
    score,
    role: "player",
    connected: true,
    team: null,
    owner: id === "a",
    moderator: id === "a",
    ...changes,
  };
}
function attempt(
  playerId: string,
  points: number,
  changes: Partial<AttemptView> = {},
): AttemptView {
  return {
    id: `attempt-${playerId}`,
    playerId,
    name: playerId.toUpperCase(),
    answer: "A submitted answer",
    verdict: "accept",
    points,
    corrected: false,
    ...changes,
  };
}
function state(changes: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "feedback-session",
    revision: 1,
    serverTime: 1000,
    selfId: "a",
    config: structuredClone(DEFAULT_CONFIG),
    pendingConfig: null,
    phase: "reveal",
    pausedReasons: [],
    players: [player("a", 20), player("b", 10)],
    teamScores: { A: 0, B: 0 },
    teamNames: { ...DEFAULT_TEAM_NAMES },
    reactions: [],
    reactionReadyAt: 0,
    block: {
      id: "block",
      format: "snapper",
      title: "Snapper",
      index: 0,
      count: 1,
      rosterIds: ["a", "b"],
    },
    question: {
      id: "question",
      text: "Question text",
      category: "Science",
      format: "snapper",
      readingComplete: true,
      answer: "Answer",
      provenance: null,
      clueNumber: null,
      sequenceLength: null,
    },
    attempts: [attempt("a", 10)],
    chat: [],
    deadline: null,
    answererId: null,
    answerWindowId: null,
    answerDraft: "",
    eligibleIds: [],
    canBuzz: false,
    canAnswer: false,
    canModerate: true,
    needsBlock: false,
    challenge: null,
    pendingAdmissions: [],
    notice: null,
    ...changes,
  };
}

test("scoring feedback distinguishes taking the lead, keeping it, and tying it", () => {
  const tookLead = state();
  const feedback = scoringFeedback(tookLead)!;
  assert.equal(feedback.points, 10);
  assert.deepEqual(feedback.leadChange, { kind: "lead", mode: "ffa", ids: ["a"] });
  assert.equal(leadChangeText(tookLead, feedback.leadChange!), "A takes the lead");

  assert.equal(
    scoringFeedback(state({ players: [player("a", 30), player("b", 10)] }))!.leadChange,
    null,
    "adding to an existing solo lead is not a lead change",
  );
  const tied = state({ players: [player("a", 10), player("b", 10)] });
  const tie = scoringFeedback(tied)!.leadChange!;
  assert.deepEqual(tie, { kind: "tie", mode: "ffa", ids: ["a", "b"] });
  assert.equal(leadChangeText(tied, tie), "Tied for the lead");
});

test("current-question penalties are included in the starting-score reconstruction", () => {
  const value = state({
    players: [player("a", 5), player("b", 10)],
    attempts: [attempt("a", -5, { verdict: "reject" }), attempt("b", 10)],
  });
  assert.equal(scoringFeedback(value)!.playerId, "b");
  assert.deepEqual(scoringFeedback(value)!.leadChange, { kind: "lead", mode: "ffa", ids: ["b"] });
});

test("corrections use the earliest accepted ruling and its current applied points", () => {
  const value = state({
    players: [player("a", 20), player("b", 20)],
    attempts: [attempt("a", 10, { corrected: true }), attempt("b", 0)],
  });
  const feedback = scoringFeedback(value)!;
  assert.equal(feedback.playerId, "a");
  assert.equal(feedback.points, 10);
  assert.equal(feedback.corrected, true);
  assert.deepEqual(feedback.leadChange, { kind: "tie", mode: "ffa", ids: ["a", "b"] });
  assert.equal(
    scoringFeedback(
      state({ attempts: [attempt("a", -5, { verdict: "reject", corrected: true })] }),
    ),
    null,
  );
});

test("score resets retain the correct ruling without inventing an award or lead change", () => {
  const feedback = scoringFeedback(
    state({
      players: [player("a", 0), player("b", 0)],
      attempts: [attempt("a", 0)],
    }),
  )!;
  assert.equal(feedback.playerId, "a");
  assert.equal(feedback.points, 0);
  assert.equal(feedback.leadChange, null);
});

test("team lead changes use the team credited by the server, including after a seat change", () => {
  const value = state({
    config: { ...DEFAULT_CONFIG, mode: "teams" },
    players: [player("a", 10, { team: "B" }), player("b", 10, { team: "B" })],
    attempts: [attempt("a", 10, { team: "A" })],
    teamScores: { A: 20, B: 10 },
    teamNames: { A: "Red pandas", B: "Blue jays" },
  });
  const change = scoringFeedback(value)!.leadChange!;
  assert.deepEqual(change, { kind: "lead", mode: "teams", ids: ["A"] });
  assert.equal(leadChangeText(value, change), "Red pandas takes the lead");
  assert.equal(scoringFeedback({ ...value, attempts: [attempt("a", 10)] })!.leadChange, null);
});

test("solo play and zero-score spectators do not create false lead announcements", () => {
  const solo = state({ players: [player("a", 10), player("watcher", 0, { role: "spectator" })] });
  assert.equal(scoringFeedback(solo)!.leadChange, null);
  assert.equal(scoringFeedback(state({ phase: "reading" })), null);
  assert.equal(scoringFeedback(state({ question: null })), null);
});

test("format reminders use configured possible points without reading answer or unrevealed content", () => {
  const value = state();
  value.config.points = {
    regular: 12,
    power: 18,
    penalty: -3,
    sequence: 25,
    clues: [50, 35, 20, 5],
  };
  const reminder = (format: Format, index = 0) =>
    formatReminder({
      ...value,
      block: { ...value.block!, format, index },
      question: { ...value.question!, format, text: "", answer: null },
    });
  assert.equal(reminder("snapper")!.points, "12 points");
  assert.equal(reminder("open")!.points, "12 points");
  assert.equal(reminder("assigned")!.points, "12 points");
  assert.equal(reminder("sequence")!.points, "25 points · all in order");
  assert.equal(reminder("clues")!.points, "50 / 35 / 20 / 5 points by clue");
  assert.equal(reminder("tossup")!.points, "12 points · 18 if power applies");
  value.config.negs = true;
  assert.equal(reminder("tossup")!.points, "12 points · 18 if power applies · -3 for a miss");
  assert.deepEqual(reminder("team", 1), {
    label: "Team bonus",
    points: "12 points · winning team only",
  });
  assert.equal(formatReminder({ ...value, question: null }), null);
});
