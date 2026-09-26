import test from "node:test";
import assert from "node:assert/strict";
import { bundledOptions, contentId, parseQB, parseTrivia, selectBundle } from "./catalog.ts";
import { DEFAULT_CONFIG, FORMATS, type PlayerView } from "./protocol.ts";
const players: PlayerView[] = Array.from({ length: 16 }, (_, i) => ({
  id: String(i),
  name: `Player ${i}`,
  role: "player",
  team: i < 8 ? "A" : "B",
  connected: true,
  owner: i === 0,
  moderator: i === 0,
  score: 0,
}));
const config = { ...DEFAULT_CONFIG, mode: "teams" as const, source: "bundled" as const };
test("original content supplies every format at maximum player count", () => {
  for (const format of FORMATS) {
    const options = bundledOptions(format, config, [], players, () => 0.5);
    assert.ok(options.length, format);
    for (const bundle of options) {
      assert.equal(new Set(bundle.atoms.map((q) => q.id)).size, bundle.atoms.length);
      for (const q of bundle.atoms) {
        assert.ok(q.answer.canonical);
        assert.ok(q.provenance.license);
        assert.ok(q.text);
      }
    }
  }
  assert.equal(bundledOptions("assigned", config, [], players)[0]!.atoms.length, 16);
  assert.equal(bundledOptions("shootout", config, [], players)[0]!.atoms.length, 32);
});
test("filters and seen IDs cannot be relaxed when content runs out", async () => {
  const narrowed = { ...config, formats: ["sequence" as const], categories: ["Canada" as const] };
  const initial = await selectBundle(narrowed, [], players);
  assert.ok(initial.bundle);
  const exhausted = await selectBundle(
    narrowed,
    initial.bundle.atoms.map((q) => q.id),
    players,
  );
  assert.equal(exhausted.bundle, null);
  assert.equal((await selectBundle({ ...narrowed, difficulty: "hard" }, [], players)).bundle, null);
});
test("all atoms share identity across standalone, open and team formats", () => {
  const open = bundledOptions("open", config, [], players)[0]!;
  const consumed = open.atoms.map((q) => q.id);
  assert.ok(
    bundledOptions("snapper", config, [], players).some((b) => consumed.includes(b.atoms[0]!.id)),
  );
  for (const format of ["snapper", "open", "team"] as const)
    assert.ok(
      bundledOptions(format, config, consumed, players).every((b) =>
        b.atoms.every((q) => !consumed.includes(q.id)),
      ),
    );
  assert.equal(contentId("Who wrote Hamlet?"), contentId(" WHO wrote Hamlet "));
});
test("service errors fall back to suitable bundled questions", async () => {
  const selected = await selectBundle(
    { ...config, source: "mixed", formats: ["tossup"] },
    [],
    players,
    async () => {
      throw new Error("offline");
    },
    () => 0,
  );
  assert.equal(selected.bundle?.format, "tossup");
  assert.match(selected.message ?? "", /bundled/);
});
test("choice-dependent or negative questions never become typed questions", () => {
  const row = {
    type: "multiple",
    difficulty: "medium",
    question: encodeURIComponent("Which of the following is NOT a planet?"),
    correct_answer: "Pluto",
  };
  assert.equal(parseTrivia(row, "Science"), null);
  const good = parseTrivia(
    {
      ...row,
      question: encodeURIComponent("What is the chemical symbol for silver?"),
      correct_answer: "Ag",
    },
    "Science",
  );
  assert.equal(good?.answer.canonical, "Ag");
  assert.match(good?.provenance.license ?? "", /CC BY-SA/);
});
test("complex quizbowl answerlines are rejected rather than overaccepted", () => {
  const row = {
    question_sanitized: "These cells contain (*) an organelle with cristae. What organelle?",
    answer_sanitized: "mitochondrion [accept mitochondria]",
    category: "Science",
  };
  assert.equal(parseQB(row, "medium"), null);
  const good = parseQB(
    {
      ...row,
      answer_sanitized: "mitochondrion",
      _id: "507f1f77bcf86cd799439011",
      set: { name: "Example High School Set" },
      packet: { name: "Finals", number: 12 },
      number: 3,
    },
    "medium",
  );
  assert.equal(good?.powerAt, "These cells contain".length);
  assert.ok(!good?.text.includes("(*)"));
  assert.equal(good?.text.slice(0, good.powerAt), "These cells contain");
  assert.deepEqual(good?.provenance, {
    label: "QB Reader · Example High School Set · Finals (packet 12) · Question 3",
    url: "https://www.qbreader.org/api/tossup?_id=507f1f77bcf86cd799439011",
    license: "Question authors retain copyright; retrieved live for noncommercial play",
  });
});
test("team-only bundles require two nonempty teams", async () => {
  assert.equal(
    (
      await selectBundle(
        { ...config, formats: ["team"] },
        [],
        players.filter((p) => p.team === "A"),
      )
    ).bundle,
    null,
  );
  assert.equal(
    (await selectBundle({ ...config, mode: "ffa", formats: ["team"] }, [], players)).bundle,
    null,
  );
});

test("live trivia requests the block size instead of exhausting a pool smaller than fifty", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  for (const [format, available] of [
    ["snapper", 1],
    ["assigned", 16],
    ["shootout", 32],
  ] as const) {
    now += 5101;
    let requested = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requested = Number(url.searchParams.get("amount"));
      // Match the provider's documented response_code=1 behavior when a query
      // asks for more questions than exist under its category/difficulty filters.
      return Response.json(
        requested > available
          ? { response_code: 1, results: [] }
          : {
              response_code: 0,
              results: Array.from({ length: requested }, (_, i) => ({
                type: "multiple",
                difficulty: "hard",
                question: encodeURIComponent(
                  `Which whole number comes immediately after value ${i}?`,
                ),
                correct_answer: String(i + 1),
              })),
            },
      );
    };
    const result = await selectBundle(
      { ...config, source: "mixed", formats: [format], categories: ["Math"], difficulty: "hard" },
      [],
      players,
      fetcher,
      () => 0,
    );
    assert.equal(requested, available, format);
    assert.equal(result.bundle?.format, format);
    assert.equal(result.bundle?.atoms.length, available);
    assert.ok(result.bundle?.atoms.every((q) => q.category === "Math" && q.difficulty === "hard"));
  }
});
