import test from "node:test";
import assert from "node:assert/strict";
import {
  addParticipant,
  configureSession,
  createSession,
  migrateSession,
  nextDeadline,
  publicView,
  readyFormats,
  setConnected,
  startBlock,
  tick,
  transition,
  type Session,
} from "./engine.ts";
import {
  DEFAULT_CONFIG,
  FORMATS,
  configSchema,
  type Format,
  type GameAction,
  type PlayerView,
  type QuestionAtom,
  type QuestionBundle,
  type RoomConfig,
  type Team,
} from "./protocol.ts";

function person(id: string, team: Team | null = null, extra: Partial<PlayerView> = {}): PlayerView {
  return {
    id,
    name: id.toUpperCase(),
    team,
    score: 0,
    role: "player",
    connected: true,
    owner: id === "a",
    moderator: id === "a",
    ...extra,
  };
}
function atom(index = 0, extra: Partial<QuestionAtom> = {}): QuestionAtom {
  return {
    id: `q-${index}`,
    text: "What color is a clear daytime sky?",
    answer: { canonical: "blue", aliases: ["azure"] },
    category: "Science",
    difficulty: "medium",
    language: "en",
    provenance: { label: "Original", license: "CC0" },
    ...extra,
  };
}
function bundle(format: Format, atoms?: QuestionAtom[]): QuestionBundle {
  return {
    id: `bundle-${format}`,
    title: "A question block",
    format,
    atoms: atoms ?? Array.from({ length: format === "open" ? 3 : 64 }, (_, index) => atom(index)),
  };
}
function initial(people = [person("a"), person("b")], options: Partial<RoomConfig> = {}): Session {
  let s = createSession(
    "session",
    people[0]!,
    {
      ...structuredClone(DEFAULT_CONFIG),
      formats: [...FORMATS],
      shortProgressive: false,
      autoAdvance: false,
      ...options,
    },
    0,
  );
  for (const p of people.slice(1)) s = addParticipant(s, p, 0);
  return s;
}
function act(s: Session, id: string, action: GameAction, now = 0): Session {
  const result = transition(s, id, action, now);
  assert.equal(result.error, undefined, `${action.type}: ${result.error}`);
  return result.state;
}
function start(
  format: Format,
  people?: PlayerView[],
  options?: Partial<RoomConfig>,
  atoms?: QuestionAtom[],
): Session {
  let s = act(initial(people, options), "a", { type: "start" });
  s = startBlock(s, bundle(format, atoms), 0);
  assert.notEqual(s.block, null);
  return s;
}
function answer(s: Session, id: string, text = "blue", now = 0): Session {
  if (s.phase === "reading") s = act(s, id, { type: "buzz" }, now);
  return act(s, id, { type: "answer", text }, now);
}
const next = (s: Session, now = 0) => act(s, "a", { type: "next" }, now);

test("server arrival order wins; duplicate buzz cannot replace the answerer", () => {
  let s = start("snapper");
  s = act(s, "b", { type: "buzz" }, 1);
  assert.equal(transition(s, "a", { type: "buzz" }, 1).error, "You cannot buzz right now.");
  assert.equal(publicView(s, "a", 1).answererId, "b");
});

test("a wrong team buzz locks the entire team, not the opponents", () => {
  let s = start("snapper", [person("a", "A"), person("b", "A"), person("c", "B")], {
    mode: "teams",
  });
  s = answer(s, "a", "green");
  assert.deepEqual(publicView(s, "b", 0).eligibleIds, ["c"]);
  s = answer(s, "c");
  assert.deepEqual(s.teamScores, { A: 0, B: 10 });
});

test("timeouts consume the attempt and late submissions cannot score", () => {
  let s = start("snapper");
  s = act(s, "a", { type: "buzz" }, 0);
  const result = transition(s, "a", { type: "answer", text: "blue" }, 8000);
  assert.ok(result.error);
  s = result.state;
  assert.equal(s.players[0]!.score, 0);
  assert.deepEqual(publicView(s, "a", 8000).eligibleIds, ["b"]);
});

test("progressive content is a server projection; snapshots contain no future text or answer", () => {
  const secret = atom(0, {
    id: "SECRET-SOURCE-ID",
    text: "AAAA BBBB CCCC SECRET FUTURE WORDS",
    answer: { canonical: "SECRET ANSWER", aliases: ["SECRET ALIAS"] },
  });
  let s = start("tossup", undefined, { wpm: 120 }, [secret]);
  const before = JSON.stringify(s);
  const view = publicView(s, "a", 500);
  assert.equal(view.question!.text, "AAAA ");
  assert.equal(view.question!.answer, null);
  assert.equal(JSON.stringify(view).includes("SECRET"), false);
  assert.equal(JSON.stringify(s), before, "projections do not persist per character");
  s = tick(s, nextDeadline(s)!);
  assert.equal(publicView(s, "a", nextDeadline(s)! - 1).question!.readingComplete, true);
});

test("manual pause freezes reading and answering rather than consuming their deadlines", () => {
  let s = start("tossup", undefined, { wpm: 120 });
  s = act(s, "a", { type: "pause" }, 500);
  assert.equal(publicView(s, "a", 20_000).question!.text.length, 5);
  assert.equal(nextDeadline(s), null);
  s = act(s, "a", { type: "resume" }, 20_000);
  assert.equal(publicView(s, "a", 20_500).question!.text.length, 10);
  s = act(s, "a", { type: "buzz" }, 20_500);
  s = act(s, "a", { type: "pause" }, 21_500);
  s = act(s, "a", { type: "resume" }, 51_500);
  assert.equal(publicView(s, "a", 51_500).deadline, 58_500);
});

test("power and negative scoring are limited to long tossups", () => {
  let s = start("tossup", undefined, { negs: true }, [atom(0, { powerAt: 20 })]);
  s = answer(s, "a", "wrong");
  assert.equal(s.players[0]!.score, -5);
  s = answer(s, "b");
  assert.equal(s.players[1]!.score, 15);
  const ordinary = answer(start("snapper", undefined, { negs: true }), "a", "wrong");
  assert.equal(ordinary.players[0]!.score, 0);
});

test("one authored clarification gets a fresh eight-second window", () => {
  let s = start("snapper", undefined, undefined, [
    atom(0, {
      answer: { canonical: "Theodore Roosevelt", aliases: [], promptAliases: ["Roosevelt"] },
    }),
  ]);
  s = answer(s, "a", "Roosevelt", 1000);
  assert.equal(s.phase, "answering");
  assert.equal(publicView(s, "a", 1000).deadline, 9000);
  s = act(s, "a", { type: "answer", text: "Roosevelt" }, 2000);
  assert.equal(s.phase, "reading");
  assert.equal(s.question!.attempts[1]!.verdict, "reject");
});

test("sequence has twenty seconds and only complete ordered answers receive twenty", () => {
  const q = atom(0, {
    answer: {
      canonical: "red, green, blue",
      aliases: [],
      orderedItems: [["red"], ["green"], ["blue"]],
    },
  });
  let s = start("sequence", undefined, undefined, [q]);
  s = act(s, "a", { type: "buzz" }, 0);
  assert.equal(publicView(s, "a", 0).deadline, 20_000);
  s = act(s, "a", { type: "answer", text: "red, blue, green" }, 1);
  s = answer(s, "b", "red; green; blue", 2);
  assert.deepEqual(
    s.players.map((p) => p.score),
    [0, 20],
  );
});

test("all four clues remain one correctable question and reset attempt locks", () => {
  const q = atom(0, { clues: ["First clue", "Second clue", "Third clue", "Fourth clue"] });
  let s = start("clues", undefined, undefined, [q]);
  assert.equal(publicView(s, "a", 0).question!.text.includes("Second"), false);
  s = answer(s, "a", "wrong");
  s = answer(s, "b", "wrong");
  assert.equal(publicView(s, "a", 0).question!.clueNumber, 2);
  assert.deepEqual(publicView(s, "a", 0).eligibleIds, ["a", "b"]);
  s = answer(s, "b");
  assert.equal(s.players[1]!.score, 30);
  const firstAttempt = s.question!.attempts[0]!.id;
  s = act(s, "a", { type: "correct", attemptId: firstAttempt, verdict: "accept" });
  assert.deepEqual(
    s.players.map((p) => p.score),
    [40, 0],
  );
  assert.equal(s.phase, "reveal");
});

test("assigned offers the designated opponent one attempt, including FFA rotation", () => {
  let s = start("assigned", [person("a"), person("b"), person("c")]);
  assert.equal(publicView(s, "a", 0).answererId, "a");
  s = act(s, "a", { type: "answer", text: "wrong" });
  assert.equal(publicView(s, "b", 0).answererId, "b");
  s = act(s, "b", { type: "answer", text: "blue" });
  s = next(s);
  assert.equal(publicView(s, "b", 0).answererId, "b");
  assert.equal(s.block!.count, 3);
});

test("assigned equalizes primary opportunities for three versus five players", () => {
  const people = [
    person("a", "A"),
    person("a2", "A"),
    person("a3", "A"),
    ...Array.from({ length: 5 }, (_, i) => person(`b${i}`, "B")),
  ];
  const s = start("assigned", people, { mode: "teams" });
  assert.equal(s.block!.count, 10);
  const turns = s.block!.turns;
  assert.equal(turns.filter((turn) => s.block!.teams[turn.primary] === "A").length, 5);
  assert.equal(turns.filter((turn) => s.block!.teams[turn.primary] === "B").length, 5);
  const allocations = ["a", "a2", "a3"]
    .map((id) => turns.filter((turn) => turn.primary === id).length)
    .sort();
  assert.deepEqual(allocations, [1, 2, 2]);
  assert.ok(
    turns.every(
      (turn) => turn.opponent && s.block!.teams[turn.primary] !== s.block!.teams[turn.opponent],
    ),
  );
});

test("an absent assigned player's active clock forfeits to the opponent", () => {
  let s = start("assigned");
  s = setConnected(s, "a", false, 1);
  s = tick(s, 8000);
  assert.equal(publicView(s, "b", 8000).answererId, "b");
  assert.equal(publicView(s, "b", 8000).deadline, 16_000);
});

test("scramble grants exclusive bonuses, one winning teammate attempt per part", () => {
  let s = start("team", [person("a", "A"), person("a2", "A"), person("b", "B")], { mode: "teams" });
  s = answer(s, "a");
  s = next(s);
  assert.deepEqual(publicView(s, "b", 0).eligibleIds, ["a", "a2"]);
  s = answer(s, "a2", "wrong");
  assert.equal(s.phase, "reveal");
  assert.equal(transition(s, "a", { type: "buzz" }, 1).error, "You cannot buzz right now.");
});

test("unearned bonuses are skipped without exposing their question text", () => {
  let s = start("team", [person("a", "A"), person("b", "B")], { mode: "teams" });
  s = answer(s, "a", "wrong");
  s = answer(s, "b", "wrong");
  s = next(s);
  assert.equal(s.block, null);
  assert.equal(s.needsBlock, true);
});

test("a frozen bonus roster retains disconnected players and excludes replacements", () => {
  let s = start(
    "team",
    [person("a", "A"), person("a2", "A"), person("b", "B"), person("b2", "B"), person("b3", "B")],
    { mode: "teams" },
  );
  s = answer(s, "a");
  s = next(s);
  s = setConnected(s, "a2", false, 0);
  s = addParticipant(s, person("new", "A"), 0);
  assert.equal(publicView(s, "new", 0).canBuzz, false);
  assert.equal(publicView(s, "a", 0).canBuzz, true);
  s = setConnected(s, "a2", true, 0);
  assert.equal(publicView(s, "a2", 0).canBuzz, true);
});

test("earliest corrected correct answer wins and later points are undone", () => {
  let s = start("snapper");
  s = answer(s, "a", "wrong");
  s = answer(s, "b");
  const id = s.question!.attempts[0]!.id;
  s = act(s, "a", { type: "correct", attemptId: id, verdict: "accept" });
  assert.deepEqual(
    s.players.map((p) => p.score),
    [10, 0],
  );
  assert.equal(s.phase, "reveal");
  s = next(s);
  assert.ok(transition(s, "a", { type: "correct", attemptId: id, verdict: "reject" }, 0).error);
});

test("challenge holds advancement until moderator resolution", () => {
  let s = answer(start("open", undefined, { autoAdvance: true }), "b");
  s = act(s, "b", { type: "challenge" }, 1000);
  s = tick(s, 50_000);
  assert.equal(s.block!.index, 0);
  assert.ok(transition(s, "b", { type: "resolve-challenge" }, 50_000).error);
  s = act(s, "a", { type: "resolve-challenge" }, 50_000);
  s = tick(s, 54_200);
  assert.equal(s.block!.index, 1);
});

test("moderator departure permits the whole automatic block, then pauses", () => {
  let s = start("open", undefined, { autoAdvance: true });
  s = setConnected(s, "a", false, 0);
  for (let i = 0; i < 3; i++) {
    const now = i * 5200;
    s = answer(s, "b", "blue", now);
    s = tick(s, now + 5200);
  }
  assert.equal(s.block, null);
  assert.equal(s.needsBlock, false);
  assert.ok(publicView(s, "b", 15600).pausedReasons.includes("Waiting for a moderator"));
  s = setConnected(s, "a", true, 16000);
  assert.equal(s.needsBlock, true);
});

test("newcomers wait for the next independent question", () => {
  let s = start("open");
  s = addParticipant(s, person("c"), 0);
  assert.equal(publicView(s, "c", 0).canBuzz, false);
  s = answer(s, "a");
  s = next(s);
  assert.equal(publicView(s, "c", 0).canBuzz, true);
});

test("configuration applies at the block boundary and mode changes retain chat/seen IDs", () => {
  let s = start("open");
  s = act(s, "b", { type: "chat", text: "hello" });
  s = configureSession(s, { ...s.config, mode: "teams" }, 0);
  assert.equal(s.config.mode, "ffa");
  assert.equal(s.pendingConfig!.mode, "teams");
  s = answer(s, "a");
  s = act(s, "a", { type: "end-block" });
  assert.equal(s.config.mode, "teams");
  assert.equal(s.players[0]!.score, 0);
  assert.equal(s.chat[0]!.text, "hello");
  assert.equal(s.usedIds.length, 3);
});

test("historical team scores stay with their original team after a switch", () => {
  let s = start("open", [person("a", "A"), person("b", "B")], { mode: "teams" });
  s = answer(s, "a");
  s = act(s, "a", { type: "team", team: "B" });
  s = next(s);
  assert.equal(s.players[0]!.team, "B");
  assert.deepEqual(s.teamScores, { A: 10, B: 0 });
});

test("switching to team mode caps restored assignments without removing player seats", () => {
  let s = initial(
    [
      person("a", "A"),
      ...Array.from({ length: 7 }, (_, i) => person(`a${i}`, "A")),
      person("b", "B"),
    ],
    { mode: "teams" },
  );
  s = setConnected(s, "a6", false, 0);
  s = addParticipant(s, person("replacement", "A"), 0);
  s = configureSession(s, { ...s.config, mode: "ffa" }, 0);
  s = setConnected(s, "a6", true, 0);
  assert.equal(
    s.players.filter((p) => p.connected && p.role === "player" && p.team === "A").length,
    9,
  );

  s = act(s, "a", { type: "start" });
  s = startBlock(s, bundle("open"), 0);
  s = act(s, "b", { type: "chat", text: "Keep this history" });
  s = answer(s, "a");
  s = configureSession(s, { ...s.config, mode: "teams" }, 0);
  assert.equal(s.config.mode, "ffa", "the active block keeps its rules");
  s = act(s, "a", { type: "end-block" });

  assert.equal(s.players.filter((p) => p.connected && p.role === "player").length, 10);
  assert.equal(
    s.players.filter((p) => p.connected && p.role === "player" && p.team === "A").length,
    8,
  );
  assert.equal(
    s.players.find((p) => p.id === "replacement")!.team,
    null,
    "stable order leaves only overflow unassigned",
  );
  assert.ok(s.players.every((p) => p.score === 0));
  assert.deepEqual(
    s.teamScores,
    { A: 0, B: 0 },
    "mode changes reset scores instead of transferring them",
  );
  assert.equal(s.chat[0]!.text, "Keep this history");
  assert.equal(s.usedIds.length, 3);
  s = act(s, "replacement", { type: "team", team: "B" });
  assert.equal(s.players.find((p) => p.id === "replacement")!.team, "B");
});

test("disconnect frees a seat immediately; a returning player waits as spectator when full", () => {
  let s = initial(Array.from({ length: 16 }, (_, i) => person(i === 0 ? "a" : `p${i}`)));
  s = setConnected(s, "p1", false, 0);
  s = addParticipant(s, person("replacement"), 0);
  s = setConnected(s, "p1", true, 0);
  assert.equal(s.players.filter((p) => p.connected && p.role === "player").length, 16);
  assert.equal(s.players.find((p) => p.id === "p1")!.role, "spectator");
  assert.equal(s.players.find((p) => p.id === "p1")!.connected, true);
});

test("team capacity and spectator capacity cannot be exceeded", () => {
  let s = initial(
    [
      person("a", "A"),
      ...Array.from({ length: 7 }, (_, i) => person(`a${i}`, "A")),
      person("b", "B"),
    ],
    { mode: "teams" },
  );
  s = addParticipant(s, person("extra", "A"), 0);
  assert.equal(s.players.find((p) => p.id === "extra")!.role, "spectator");
  for (let i = 0; i < 16; i++)
    s = addParticipant(s, person(`s${i}`, null, { role: "spectator" }), 0);
  assert.equal(s.players.filter((p) => p.connected && p.role === "spectator").length, 16);
  assert.equal(s.players.find((p) => p.id === "s15")!.connected, false);
});

test("moderation and owner permissions are distinct; malformed payloads are rejected", () => {
  let s = initial([person("a"), person("b", null, { moderator: true }), person("c")]);
  assert.ok(transition(s, "c", { type: "start" }, 0).error);
  assert.ok(transition(s, "b", { type: "configure", config: s.config }, 0).error);
  assert.ok(transition(s, "b", { type: "promote", playerId: "c", moderator: true }, 0).error);
  assert.ok(transition(s, "b", { type: "kick", playerId: "a" }, 0).error);
  assert.ok(transition(s, "a", { type: "answer", text: 123 } as unknown as GameAction, 0).error);
  s = act(s, "a", { type: "promote", playerId: "c", moderator: true });
  assert.equal(publicView(s, "c", 0).canModerate, true);
});

test("removed players retain history but are visibly removed and cannot reconnect", () => {
  let s = answer(start("snapper"), "b");
  s = act(s, "a", { type: "kick", playerId: "b" });
  const removed = publicView(s, "a", 0).players.find((p) => p.id === "b")!;
  assert.equal(removed.removed, true);
  assert.equal(removed.connected, false);
  assert.equal(removed.score, 10);
  assert.equal(setConnected(s, "b", true, 1), s);
  assert.ok(transition(s, "a", { type: "kick", playerId: "b" }, 1).error);
});

test("idle pause is explicit and requires a moderator to resume", () => {
  let s = initial();
  s = tick(s, 600_000);
  assert.ok(publicView(s, "a", 600_000).pausedReasons.includes("Paused after ten minutes idle"));
  s = act(s, "b", { type: "chat", text: "back" }, 600_001);
  assert.ok(s.pauses.includes("idle"));
  assert.ok(transition(s, "b", { type: "resume" }, 600_002).error);
  s = act(s, "a", { type: "resume" }, 600_003);
  assert.equal(s.pauses.length, 0);
});

test("team-dependent formats require two nonempty teams; FFA excludes scramble", () => {
  const teams = initial([person("a", "A")], { mode: "teams" });
  assert.ok(!readyFormats(teams).some((format) => ["team", "assigned"].includes(format)));
  assert.ok(!readyFormats(initial()).includes("team"));
});

test("legacy Shootout settings in either mode become Snappers and cannot start Shootout", () => {
  assert.ok(!(FORMATS as readonly string[]).includes("shootout"));
  for (const mode of ["ffa", "teams"] as const) {
    const config = configSchema.parse({
      ...DEFAULT_CONFIG,
      mode,
      formats: ["shootout", "snapper"],
    });
    assert.deepEqual(config.formats, ["snapper"]);
    let s = initial([person("a", "A"), person("b", "B")], config);
    // A stored session can predate schema normalization: readiness still handles it.
    s.config.formats = ["shootout", "snapper"] as unknown as Format[];
    assert.deepEqual(readyFormats(s), ["snapper"]);
    s = migrateSession(s, 0);
    s = act(s, "a", { type: "start" });
    const legacyBundle = { ...bundle("snapper"), format: "shootout" } as unknown as QuestionBundle;
    assert.equal(startBlock(s, legacyBundle, 0), s, "no new Shootout block can start");
    s = startBlock(s, bundle("snapper", [atom(1)]), 0);
    s = answer(s, "a");
    s = next(s);
    s = startBlock(s, bundle("snapper", [atom(2)]), 0);
    assert.equal(publicView(s, "a", 0).canBuzz, true, "a winner is not retired");
    assert.deepEqual(s.usedIds, ["q-1", "q-2"]);
  }
});

function legacyShootout(mode: "ffa" | "teams"): Session {
  let s = start("open", [person("a", "A"), person("b", "B")], { mode });
  s = answer(s, "a");
  s = next(s);
  s = answer(s, "b", "wrong", 50);
  s = act(s, "a", { type: "buzz" }, 100);
  s.config.formats = ["shootout", "snapper", "open"] as unknown as Format[];
  s.pendingConfig = {
    ...structuredClone(s.config),
    formats: ["snapper", "shootout"] as unknown as Format[],
  };
  const obsolete = { used: { A: 1, B: 0 }, cycle: { A: ["a"], B: [] }, done: ["a"] };
  Object.assign(s.block!.bundle, { format: "shootout", title: "Shootout" });
  Object.assign(s.block!, { shoot: structuredClone(obsolete) });
  Object.assign(s.question!, { baseShoot: structuredClone(obsolete) });
  return s;
}

test("stored Shootout migration preserves the current answer and releases only unasked questions", () => {
  for (const mode of ["ffa", "teams"] as const) {
    const original = legacyShootout(mode);
    const originalJson = JSON.stringify(original);
    const before = publicView(original, "a", 200);
    const s = migrateSession(original, 200);
    assert.equal(JSON.stringify(original), originalJson, "migration must not mutate storage input");
    assert.deepEqual(s.config.formats, ["snapper", "open"]);
    assert.deepEqual(s.pendingConfig!.formats, ["snapper"]);
    assert.equal(s.block!.bundle.format, "snapper");
    assert.equal(s.block!.bundle.title, "Quick snapper");
    assert.equal(s.block!.index, 1);
    assert.equal(s.block!.count, 2);
    assert.deepEqual(
      s.block!.bundle.atoms.map((q) => q.id),
      ["q-0", "q-1"],
    );
    assert.deepEqual(s.usedIds, ["q-0", "q-1"]);
    assert.equal("shoot" in s.block!, false);
    assert.equal("baseShoot" in s.question!, false);
    const expectedQuestion = { ...original.question! };
    delete (expectedQuestion as { baseShoot?: unknown }).baseShoot;
    assert.deepEqual(s.question, expectedQuestion);
    assert.deepEqual(s.players, original.players);
    assert.deepEqual(s.teamScores, original.teamScores);
    const after = publicView(s, "a", 200);
    assert.equal(after.question!.id, before.question!.id);
    assert.equal(after.answerWindowId, before.answerWindowId);
    assert.equal(after.deadline, before.deadline);
    assert.deepEqual(after.attempts, before.attempts);
    assert.equal(migrateSession(s, 300), s, "already-migrated state is an identity no-op");

    let finished = answer(s, "a", "blue", 300);
    finished = next(finished, 300);
    assert.equal(finished.block, null, "migration ends the block after its current question");
    finished = startBlock(finished, bundle("snapper", [atom(2)]), 300);
    assert.equal(finished.question!.atom.id, "q-2", "the unasked tail returns to normal play");
    assert.equal(publicView(finished, "a", 300).canBuzz, true);
  }
});

test("migration removes retirement holds while preserving manual and challenge pauses", () => {
  let original = legacyShootout("teams");
  original = answer(original, "a", "blue", 150);
  original = act(original, "b", { type: "challenge" }, 200);
  original = act(original, "a", { type: "pause" }, 200);
  original.pauses.push("participants");
  const s = migrateSession(original, 5000);
  assert.deepEqual(s.pauses, ["challenge", "manual"]);
  assert.equal(s.pausedAt, 200);
  assert.equal(s.question!.revealAt, original.question!.revealAt);
  assert.deepEqual(s.challenge, original.challenge);
  assert.deepEqual(s.players, original.players);
  assert.equal(nextDeadline(s), null);
  const attemptId = s.question!.attempts[0]!.id;
  const corrected = act(s, "a", { type: "correct", attemptId, verdict: "accept" }, 5000);
  assert.deepEqual(
    corrected.players.map((p) => p.score),
    [10, 10],
  );
  assert.equal(corrected.phase, "reveal", "correction never reopens the revealed prompt");

  const onlyRetirement = legacyShootout("ffa");
  onlyRetirement.pauses = ["participants"];
  onlyRetirement.pausedAt = 200;
  const resumed = migrateSession(onlyRetirement, 1200);
  assert.deepEqual(resumed.pauses, []);
  assert.equal(resumed.question!.answerAt, onlyRetirement.question!.answerAt! + 1000);
  assert.equal(publicView(resumed, "a", 1200).canAnswer, true);
});

test("migration with no current question releases unasked IDs and returns safely to waiting", () => {
  const original = legacyShootout("teams");
  original.question = null;
  original.phase = "waiting";
  original.pauses = ["manual", "participants"];
  original.pausedAt = 200;
  const s = migrateSession(original, 500);
  assert.equal(s.block, null);
  assert.equal(s.question, null);
  assert.equal(s.phase, "waiting");
  assert.deepEqual(s.usedIds, ["q-0"]);
  assert.deepEqual(s.players, original.players);
  assert.deepEqual(s.pauses, ["manual"]);
  assert.equal(s.needsBlock, false);
  assert.deepEqual(s.config.formats, ["snapper"]);
  assert.equal(s.pendingConfig, null);
});

test("obsolete Shootout fields on other formats are pruned without changing play", () => {
  const original = start("assigned");
  Object.assign(original.block!, { shoot: { done: [] } });
  Object.assign(original.question!, { baseShoot: { done: [] } });
  const s = migrateSession(original, 200);
  assert.equal("shoot" in s.block!, false);
  assert.equal("baseShoot" in s.question!, false);
  assert.equal(s.block!.bundle.format, "assigned");
  assert.deepEqual(publicView(s, "a", 200), {
    ...publicView(original, "a", 200),
    revision: s.revision,
  });
});

test("used questions cannot be replayed or duplicated inside a selected bundle", () => {
  let s = start("snapper");
  s = answer(s, "a");
  s = next(s);
  assert.equal(startBlock(s, bundle("snapper"), 0), s);
  assert.equal(startBlock(s, bundle("open", [atom(99), atom(99), atom(100)]), 0), s);
});

test("state transitions do not mutate snapshots held by the coordinator", () => {
  const s = start("snapper"),
    before = JSON.stringify(s);
  answer(s, "a");
  assert.equal(JSON.stringify(s), before);
});

test("a bonus dropout hold resumes only when the original eligible player returns", () => {
  let s = start("team", [person("a", "A"), person("b", "B")], { mode: "teams" });
  s = answer(s, "b");
  s = setConnected(s, "b", false, 1);
  s = next(s, 2);
  assert.ok(s.pauses.includes("participants"));
  s = addParticipant(s, person("new", "B"), 3);
  assert.ok(s.pauses.includes("participants"));
  s = setConnected(s, "b", true, 4);
  assert.equal(s.pauses.length, 0);
  s = next(s, 4);
  assert.deepEqual(publicView(s, "b", 4).eligibleIds, ["b"]);
});

test("resetting scores cannot resurrect erased points through a later correction", () => {
  let s = start("snapper", [person("a", "A"), person("b", "B")], { mode: "teams" });
  s = answer(s, "a");
  const attempt = s.question!.attempts[0]!.id;
  s = act(s, "a", { type: "reset-scores" });
  assert.equal(s.players[0]!.score, 0);
  s = act(s, "a", { type: "correct", attemptId: attempt, verdict: "reject" });
  assert.equal(s.players[0]!.score, 0);
  assert.equal(s.teamScores.A, 0);
});

test("a same-verdict correction does not steal another player's active answer window", () => {
  let s = start("snapper");
  s = answer(s, "a", "wrong");
  const attempt = s.question!.attempts[0]!.id;
  s = act(s, "b", { type: "buzz" }, 100);
  s = act(s, "a", { type: "correct", attemptId: attempt, verdict: "reject" }, 200);
  assert.equal(publicView(s, "b", 200).answererId, "b");
  assert.equal(publicView(s, "b", 200).deadline, 8100);
});

test("returning through a spectator seat cannot bypass a frozen team assignment", () => {
  let s = start("team", [person("a", "A"), person("b", "B")], { mode: "teams" });
  s = act(s, "a", { type: "spectate" });
  const switched = transition(s, "a", { type: "take-seat", team: "B" }, 0);
  assert.ok(switched.error);
  s = act(s, "a", { type: "take-seat", team: "A" });
  assert.equal(publicView(s, "a", 0).canBuzz, true);
});

test("full spectators leave a returning identity capacity-waiting rather than overflow", () => {
  let s = initial(Array.from({ length: 16 }, (_, i) => person(i === 0 ? "a" : `p${i}`)));
  s = setConnected(s, "p1", false, 0);
  s = addParticipant(s, person("replacement"), 0);
  for (let i = 0; i < 16; i++)
    s = addParticipant(s, person(`s${i}`, null, { role: "spectator" }), 0);
  s = setConnected(s, "p1", true, 0);
  assert.equal(s.players.find((p) => p.id === "p1")!.connected, false);
  assert.equal(s.players.filter((p) => p.connected).length, 32);
});

test("an Open block ends after all authored questions even when nobody scores", () => {
  let s = start("open", [person("a", "A"), person("b", "B")], { mode: "teams" });
  for (let i = 0; i < 3; i++) {
    s = answer(s, "a", "wrong");
    s = answer(s, "b", "wrong");
    s = next(s);
  }
  assert.equal(s.block, null);
  assert.equal(s.needsBlock, true);
  assert.equal(s.usedIds.length, 3);
});

test("restoring serialized coordinator state preserves deadlines and eligibility", () => {
  let s = start("open", undefined, { autoAdvance: true });
  s = act(s, "b", { type: "buzz" }, 123);
  const restored: Session = JSON.parse(JSON.stringify(s));
  assert.deepEqual(publicView(restored, "b", 500), publicView(s, "b", 500));
  assert.deepEqual(tick(restored, 8123), tick(s, 8123));
});
