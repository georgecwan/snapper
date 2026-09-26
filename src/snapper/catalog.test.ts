import test from "node:test";
import assert from "node:assert/strict";
import { bundledOptions, contentId, parseQB, parseTrivia, selectBundle } from "./catalog.ts";
import { SHORTS } from "./bank.ts";
import {
  CATEGORIES,
  DEFAULT_CONFIG,
  FORMATS,
  configSchema,
  type PlayerView,
  type QuestionAtom,
} from "./protocol.ts";
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
});

test("every short question remains available as an independent Snapper", () => {
  const options = bundledOptions(
    "snapper",
    { ...config, categories: [...CATEGORIES], difficulty: "any" },
    [],
    players,
  );
  assert.deepEqual(
    new Set(options.map((bundle) => bundle.atoms[0]!.id)),
    new Set(SHORTS.map((question) => contentId(question.text))),
  );
  assert.ok(options.every((bundle) => bundle.format === "snapper" && bundle.atoms.length === 1));
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

test("both modes convert legacy Shootout settings to one ordinary Snapper selection", async () => {
  for (const mode of ["ffa", "teams"] as const) {
    const migrated = configSchema.parse({
      ...config,
      mode,
      formats: ["shootout", "snapper"],
    });
    assert.deepEqual(migrated.formats, ["snapper"]);
    const first = await selectBundle(migrated, [], players, fetch, () => 0.4);
    assert.equal(first.bundle?.format, "snapper");
    assert.equal(first.bundle?.atoms.length, 1);
    const next = await selectBundle(
      migrated,
      first.bundle!.atoms.map((q) => q.id),
      players,
      fetch,
      () => 0.4,
    );
    assert.equal(next.bundle?.format, "snapper");
    assert.notEqual(next.bundle!.atoms[0]!.id, first.bundle!.atoms[0]!.id);
  }
});

test("live trivia requests the block size instead of exhausting a pool smaller than fifty", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  for (const [format, available] of [
    ["snapper", 1],
    ["assigned", 16],
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

const packedQuestion = (n: number, changes: Partial<QuestionAtom> = {}): QuestionAtom => {
  const text = `Name the hard science example associated with catalogue entry ${n}.`;
  return {
    id: contentId(text),
    text,
    category: "Science",
    language: "en",
    difficulty: "hard",
    answer: { canonical: `Example ${n}`, aliases: [] },
    provenance: { label: "Repository fixture", license: "CC0" },
    ...changes,
  };
};

test("format chances follow a 9:1 matching inventory ratio and change with the filters", async () => {
  for (const category of ["Science", "Math"] as const) {
    let tossups = 0;
    for (let ticket = 0; ticket < 100; ticket++) {
      const selected = await selectBundle(
        {
          ...config,
          formats: ["tossup", "snapper"],
          categories: [category],
          difficulty: "hard",
        },
        [],
        players,
        fetch,
        () => (ticket + 0.5) / 100,
        async (format) => [packedQuestion(format === "tossup" ? 1 : 2, { category })],
        async (matching) => {
          assert.deepEqual(matching.categories, [category]);
          assert.equal(matching.difficulty, "hard");
          return category === "Science" ? { tossup: 9, snapper: 1 } : { tossup: 1, snapper: 9 };
        },
      );
      if (selected.bundle?.format === "tossup") tossups++;
    }
    assert.equal(tossups, category === "Science" ? 90 : 10);
  }
});

test("disabled formats and legacy aliases cannot add duplicate format weight", async () => {
  const migrated = configSchema.parse({
    ...config,
    formats: ["shootout", "snapper", "tossup"],
    categories: ["Science"],
    difficulty: "hard",
  });
  let snappers = 0;
  for (let ticket = 0; ticket < 100; ticket++) {
    const selected = await selectBundle(
      migrated,
      [],
      players,
      fetch,
      () => (ticket + 0.5) / 100,
      async (format) => [packedQuestion(format === "tossup" ? 1 : 2)],
      async () => ({ tossup: 9, snapper: 1 }),
    );
    if (selected.bundle?.format === "snapper") snappers++;
  }
  assert.equal(snappers, 10, "the retired alias does not double Snapper's selection chance");
  const selected = await selectBundle(
    { ...migrated, formats: ["snapper"] },
    [],
    players,
    fetch,
    () => 0,
    async (format) => {
      assert.equal(
        format,
        "snapper",
        "a disabled format cannot be selected even with more content",
      );
      return [packedQuestion(2)];
    },
    async () => ({ tossup: 900, snapper: 1 }),
  );
  assert.equal(selected.bundle?.format, "snapper");
});

test("authored group weighting counts only complete unseen groups and their distinct questions", async () => {
  const narrowed = {
    ...config,
    formats: ["open" as const, "snapper" as const],
    categories: ["Science" as const],
  };
  const used = [bundledOptions("open", narrowed, [], players)[0]!.atoms[0]!.id];
  // Science has three authored groups of four and twelve short questions.
  // Consuming one member leaves eight group questions and eleven singles.
  const first = await selectBundle(narrowed, used, players, fetch, () => 0.4);
  assert.equal(first.bundle?.format, "open", "0.4 is within the group's 8/19 share");
  const next = await selectBundle(narrowed, used, players, fetch, () => 0.45);
  assert.equal(next.bundle?.format, "snapper", "0.45 is outside the group's 8/19 share");
  assert.ok(
    [first.bundle, next.bundle].every((bundle) => bundle?.atoms.every((q) => !used.includes(q.id))),
  );
});

test("Assigned is weighted only when the matching inventory can fill its whole block", async () => {
  const selected = await selectBundle(
    { ...config, formats: ["assigned", "snapper"], categories: ["Science"] },
    [],
    players,
    fetch,
    () => 0,
    async (_format, _matching, _used, count) => {
      assert.equal(
        count,
        1,
        "twelve curated questions cannot fill a sixteen-player Assigned block",
      );
      return [];
    },
    async () => ({ tossup: 0, snapper: 0 }),
  );
  assert.equal(selected.bundle?.format, "snapper");
});

test("exhausted weighted formats are tried once then removed without repeating content", async () => {
  const old = packedQuestion(1);
  const fresh = packedQuestion(2);
  for (const exhausted of [false, true]) {
    const calls: string[] = [];
    const selected = await selectBundle(
      { ...config, formats: ["tossup", "snapper"], difficulty: "hard", categories: ["Science"] },
      exhausted ? [old.id, fresh.id] : [old.id],
      players,
      fetch,
      () => 0,
      async (format) => {
        calls.push(format);
        return [format === "tossup" ? old : fresh];
      },
      async () => ({ tossup: 9, snapper: 1 }),
    );
    assert.deepEqual(calls, ["tossup", "snapper"]);
    if (exhausted) assert.equal(selected.bundle, null);
    else assert.deepEqual(selected.bundle?.atoms, [fresh]);
  }
});

test("a failed inventory lookup keeps an otherwise working repository format available", async () => {
  const selected = await selectBundle(
    { ...config, formats: ["tossup"], difficulty: "hard", categories: ["Science"] },
    [],
    players,
    fetch,
    () => 0,
    async () => [packedQuestion(1)],
    async () => {
      throw new Error("inventory unavailable");
    },
  );
  assert.equal(selected.bundle?.format, "tossup");
  assert.equal(selected.bundle?.atoms[0]!.id, packedQuestion(1).id);
});

test("repository packs supply tossups, Snappers and complete 16-question Assigned blocks", async () => {
  for (const [format, expectedFormat, count] of [
    ["tossup", "tossup", 1],
    ["snapper", "snapper", 1],
    ["assigned", "snapper", 16],
  ] as const) {
    let calls = 0;
    const result = await selectBundle(
      { ...config, formats: [format], difficulty: "hard", categories: ["Science"] },
      [],
      players,
      fetch,
      () => 0,
      async (kind, requestedConfig, used, needed) => {
        calls++;
        assert.equal(kind, expectedFormat);
        assert.equal(needed, count);
        assert.equal(requestedConfig.difficulty, "hard");
        assert.deepEqual(used, []);
        return Array.from({ length: needed }, (_, n) => packedQuestion(n));
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.bundle?.format, format);
    assert.equal(result.bundle?.atoms.length, count);
    assert.equal(new Set(result.bundle?.atoms.map((q) => q.id)).size, count);
  }
});

test("repository results cannot bypass deduplication, filters, or complete-block demand", async () => {
  const used = packedQuestion(1);
  const wrongCategory = packedQuestion(2, { category: "Math" });
  const wrongRating = packedQuestion(3, { difficulty: "easy" });
  const candidate = packedQuestion(4);
  const selected = await selectBundle(
    { ...config, formats: ["snapper"], difficulty: "hard", categories: ["Science"] },
    [used.id],
    players,
    fetch,
    () => 0,
    async () => [
      used,
      wrongCategory,
      wrongRating,
      candidate,
      { ...candidate, id: "provider-alias" },
    ],
  );
  assert.deepEqual(selected.bundle?.atoms, [candidate]);
  const incomplete = await selectBundle(
    { ...config, formats: ["assigned"], difficulty: "hard", categories: ["Science"] },
    [],
    players,
    fetch,
    () => 0,
    async () => [candidate, candidate],
  );
  assert.equal(incomplete.bundle, null, "a partial assignment must not begin");
});

test("partial repository blocks can use distinct compatible original questions", async () => {
  const one = packedQuestion(1, { difficulty: "medium" });
  const result = await selectBundle(
    { ...config, formats: ["assigned"] },
    [],
    players,
    fetch,
    () => 0,
    async () => [one],
  );
  assert.equal(result.bundle?.atoms.length, 16);
  assert.equal(result.bundle?.atoms[0]?.id, one.id);
  assert.equal(new Set(result.bundle?.atoms.map((q) => q.id)).size, 16);
});

test("unrated repository selection does not send unsupported filters to live providers", async () => {
  const question = packedQuestion(1, { difficulty: "unrated" });
  const result = await selectBundle(
    { ...config, source: "mixed", formats: ["tossup"], difficulty: "unrated" },
    [],
    players,
    async () => {
      throw new Error("External provider must not be called");
    },
    () => 0,
    async () => [question],
  );
  assert.deepEqual(result.bundle?.atoms, [question]);
  assert.equal(result.message, undefined);
});

test("missing repository assets retain suitable original content and all authored special formats", async () => {
  const failed = await selectBundle(
    { ...config, formats: ["tossup"] },
    [],
    players,
    fetch,
    () => 0,
    async () => {
      throw new Error("missing asset");
    },
  );
  assert.equal(failed.bundle?.format, "tossup");
  for (const format of ["open", "team", "sequence", "clues"] as const) {
    let calls = 0;
    const selected = await selectBundle(
      { ...config, formats: [format] },
      [],
      players,
      fetch,
      () => 0,
      async () => {
        calls++;
        return [];
      },
    );
    assert.equal(selected.bundle?.format, format);
    assert.equal(calls, 0, `${format} keeps its authored structure`);
  }
});

const liveTossup = {
  question_sanitized:
    "This hard science test question is provided by the live service. Name its example.",
  answer_sanitized: "Live example",
  category: "Science",
};

test("mixed sources give the local corpus half the first choices even when live retrieval is healthy", async () => {
  let liveCalls = 0;
  let localCalls = 0;
  let localSelections = 0;
  for (let ticket = 0; ticket < 100; ticket++) {
    const selected = await selectBundle(
      {
        ...config,
        source: "mixed",
        formats: ["tossup"],
        categories: ["Science"],
        difficulty: "hard",
      },
      [],
      players,
      async () => {
        liveCalls++;
        return Response.json({ tossups: [liveTossup] });
      },
      () => (ticket + 0.5) / 100,
      async () => {
        localCalls++;
        return [packedQuestion(10)];
      },
      async () => ({ tossup: 1000, snapper: 0 }),
    );
    assert.ok(selected.bundle);
    if (selected.bundle.atoms[0]!.id === packedQuestion(10).id) localSelections++;
  }
  assert.equal(localSelections, 50);
  assert.equal(liveCalls, 50, "local-first success makes no unnecessary provider call");
  assert.equal(localCalls, 50, "live-first success makes no unnecessary shard read");
});

test("repeated live results fall through to unseen repository questions then exhaust safely", async () => {
  const used: string[] = [];
  const local = [packedQuestion(20), packedQuestion(21)];
  const matching = {
    ...config,
    source: "mixed" as const,
    formats: ["tossup" as const],
    categories: ["Science" as const],
    difficulty: "hard" as const,
  };
  for (let round = 0; round < 4; round++) {
    const selected = await selectBundle(
      matching,
      used,
      players,
      async () => Response.json({ tossups: [liveTossup] }),
      () => 0,
      async () => local, // Defensively filter even a loader that returns used IDs.
      async () => ({ tossup: 2, snapper: 0 }),
    );
    if (round === 3) assert.equal(selected.bundle, null);
    else {
      assert.ok(selected.bundle);
      const id = selected.bundle.atoms[0]!.id;
      assert.ok(!used.includes(id));
      used.push(id);
    }
  }
  assert.equal(new Set(used).size, 3);
});

test("an unavailable local-first pool still falls back to the live source", async () => {
  let requests = 0;
  const selected = await selectBundle(
    {
      ...config,
      source: "mixed",
      formats: ["tossup"],
      categories: ["Science"],
      difficulty: "hard",
    },
    [],
    players,
    async () => {
      requests++;
      return Response.json({ tossups: [liveTossup] });
    },
    () => 0.75,
    async () => {
      throw new Error("Temporary pack failure");
    },
    async () => ({ tossup: 1000, snapper: 0 }),
  );
  assert.equal(requests, 1);
  assert.equal(selected.bundle?.atoms[0]?.id, contentId(liveTossup.question_sanitized));
});
