import test from "node:test";
import assert from "node:assert/strict";
import { contentId } from "../src/snapper/catalog.ts";
import { DEFAULT_CONFIG, type QuestionAtom } from "../src/snapper/protocol.ts";
import { privateAssetPath, QuestionPacks, QUESTION_PACK_PREFIX } from "./question-packs.ts";

function question(n: number, changes: Partial<QuestionAtom> = {}): QuestionAtom {
  const text = `What test object is identified by the unique serial number ${n}?`;
  return {
    id: contentId(text),
    text,
    category: "Science",
    difficulty: "medium",
    language: "en",
    answer: { canonical: `Object ${n}`, aliases: [] },
    provenance: { label: "Test pack", license: "CC0" },
    ...changes,
  };
}

function fixture(shards: QuestionAtom[][], format = "tossup") {
  const files = new Map<string, unknown>();
  const paths = shards.map((_, i) => `${format}/science/medium/shard-${i}.json`);
  const index = `${format}/science/medium/index.json`;
  files.set("manifest.json", {
    version: 1,
    total: shards.flat().length,
    groups: [
      { format, category: "Science", difficulty: "medium", index, count: shards.flat().length },
    ],
  });
  files.set(index, {
    shards: shards.map((atoms, i) => ({ path: paths[i], ids: atoms.map((q) => q.id) })),
  });
  for (const [i, atoms] of shards.entries()) files.set(paths[i]!, atoms);
  const requests: string[] = [];
  const assets = {
    async fetch(input: Request | string) {
      const req = typeof input === "string" ? new Request(input) : input;
      const url = new URL(req.url);
      assert.equal(url.host, "questions.internal");
      assert.equal(req.headers.get("Cookie"), null);
      assert.equal(req.headers.get("Sec-Fetch-Mode"), null);
      assert.equal(req.headers.get("Range"), null);
      const path = url.pathname.slice(`${QUESTION_PACK_PREFIX}/`.length);
      requests.push(path);
      return files.has(path)
        ? Response.json(files.get(path))
        : new Response("<html>SPA fallback</html>", { headers: { "Content-Type": "text/html" } });
    },
  };
  return { files, paths, index, requests, loader: new QuestionPacks(assets) };
}
const config = { ...DEFAULT_CONFIG, categories: ["Science" as const], source: "bundled" as const };

test("one selection from thousands fetches one index and one shard, never the entire corpus", async () => {
  const shards = Array.from({ length: 40 }, (_, s) =>
    Array.from({ length: 128 }, (_, q) => question(128 * s + q)),
  );
  const { loader, requests, index, paths } = fixture(shards);
  const result = await loader.select("tossup", config, [], 1, () => 0);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, shards.at(-1)!.at(-1)!.id);
  assert.deepEqual(requests, ["manifest.json", index, paths.at(-1)]);
  await loader.select("tossup", config, [], 1, () => 0);
  assert.equal(requests.length, 3, "repeated access should use bounded caches");
});

test("used IDs are eliminated in the index without loading consumed shards", async () => {
  const shards = [
    [question(1), question(2)],
    [question(3), question(4)],
  ];
  const { loader, requests, paths } = fixture(shards);
  const result = await loader.select(
    "tossup",
    config,
    shards[1]!.map((q) => q.id),
    2,
    () => 0,
  );
  assert.deepEqual(new Set(result.map((q) => q.id)), new Set(shards[0]!.map((q) => q.id)));
  assert.ok(!requests.includes(paths[1]!));
  const before = requests.length;
  assert.deepEqual(
    await loader.select(
      "tossup",
      config,
      shards.flat().map((q) => q.id),
      1,
      () => 0,
    ),
    [],
  );
  assert.equal(requests.length, before);
});

test("format, category and rating filters are enforced before reading indexes", async () => {
  const { loader, requests } = fixture([[question(1)]]);
  for (const changed of [
    { ...config, categories: ["Math" as const] },
    { ...config, difficulty: "hard" as const },
    { ...config, difficulty: "unrated" as const },
  ])
    assert.deepEqual(await loader.select("tossup", changed, [], 1, () => 0), []);
  assert.deepEqual(await loader.select("snapper", config, [], 1, () => 0), []);
  assert.deepEqual(requests, ["manifest.json"]);
});

test("unrated content is available only under any or unrated, never guessed as medium", async () => {
  const { loader, files, index } = fixture([[question(1, { difficulty: "unrated" })]]);
  files.set("manifest.json", {
    version: 1,
    total: 1,
    groups: [{ format: "tossup", category: "Science", difficulty: "unrated", index, count: 1 }],
  });
  assert.equal((await loader.select("tossup", config, [], 1, () => 0)).length, 0);
  assert.equal(
    (await loader.select("tossup", { ...config, difficulty: "any" }, [], 1, () => 0)).length,
    1,
  );
  assert.equal(
    (await loader.select("tossup", { ...config, difficulty: "unrated" }, [], 1, () => 0)).length,
    1,
  );
});

test("a complete short block contains exactly the required distinct unseen questions", async () => {
  const { loader } = fixture([Array.from({ length: 128 }, (_, n) => question(n))], "snapper");
  const used = [question(127).id, question(126).id];
  const result = await loader.select("snapper", config, used, 32, () => 0);
  assert.equal(result.length, 32);
  assert.equal(new Set(result.map((q) => q.id)).size, 32);
  assert.ok(result.every((q) => !used.includes(q.id)));
});

test("block selection mixes weighted groups and redistributes exhausted demand without rereading indexes", async () => {
  const science = Array.from({ length: 16 }, (_, n) => question(n));
  const history = Array.from({ length: 16 }, (_, n) => question(100 + n, { category: "History" }));
  for (const exhausted of [false, true]) {
    const { loader, files, requests, index } = fixture([science], "snapper");
    const historyIndex = "snapper/history/medium/index.json";
    const historyShard = "snapper/history/medium/0000.json";
    files.set("manifest.json", {
      version: 1,
      total: 32,
      groups: [
        { format: "snapper", category: "Science", difficulty: "medium", index, count: 16 },
        {
          format: "snapper",
          category: "History",
          difficulty: "medium",
          index: historyIndex,
          count: 16,
        },
      ],
    });
    files.set(historyIndex, { shards: [{ path: historyShard, ids: history.map((q) => q.id) }] });
    files.set(historyShard, history);
    let draw = 0;
    const used = exhausted ? science.slice(0, 14).map((q) => q.id) : [];
    const result = await loader.select(
      "snapper",
      { ...config, categories: ["Science", "History"] },
      used,
      16,
      () => (draw++ % 2 ? 0.9999 : 0),
    );
    assert.equal(result.length, 16);
    assert.equal(new Set(result.map((q) => q.id)).size, 16);
    assert.ok(result.every((q) => !used.includes(q.id)));
    assert.equal(result.filter((q) => q.category === "Science").length, exhausted ? 2 : 8);
    assert.equal(requests.filter((path) => path === index).length, 1);
    assert.equal(requests.filter((path) => path === historyIndex).length, 1);
  }
});

test("bounded shard caches evict older data instead of accumulating the corpus", async () => {
  const shards = Array.from({ length: 10 }, (_, n) => [question(n)]);
  const { loader, requests, paths } = fixture(shards);
  for (const n of [...Array(10).keys(), 0]) {
    const used = shards
      .flat()
      .filter((_, i) => i !== n)
      .map((q) => q.id);
    assert.equal((await loader.select("tossup", config, used, 1, () => 0))[0]!.id, question(n).id);
  }
  assert.equal(requests.filter((path) => path === paths[0]).length, 2);
  assert.equal(requests.filter((path) => path === "manifest.json").length, 1);
});

test("missing/HTML assets are a bounded failure rather than an endless fetch loop", async () => {
  const { loader, files, requests } = fixture([[question(1)]]);
  files.delete("manifest.json");
  assert.deepEqual(await loader.select("tossup", config, [], 1, () => 0), []);
  assert.deepEqual(await loader.select("tossup", config, [], 1, () => 0), []);
  assert.deepEqual(requests, ["manifest.json"]);
});

test("invalid paths, duplicate indexes, wrong metadata and forged content IDs fail closed", async () => {
  for (const kind of ["path", "duplicate", "category", "id"] as const) {
    const { loader, files, index, paths } = fixture([[question(1)]]);
    if (kind === "path")
      files.set(index, { shards: [{ path: "../index.json", ids: [question(1).id] }] });
    if (kind === "duplicate")
      files.set(index, { shards: [{ path: paths[0], ids: [question(1).id, question(1).id] }] });
    if (kind === "category") files.set(paths[0]!, [question(1, { category: "Math" })]);
    if (kind === "id")
      files.set(paths[0]!, [
        question(1, { text: "A different question with a mismatched identity?" }),
      ]);
    assert.deepEqual(await loader.select("tossup", config, [], 1, () => 0), [], kind);
  }
});

test("oversized asset bodies are rejected even without a Content-Length header", async () => {
  let calls = 0;
  const loader = new QuestionPacks({
    async fetch() {
      calls++;
      return new Response(" ".repeat(128 * 1024 + 1), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.deepEqual(await loader.select("tossup", config, [], 1, () => 0), []);
  assert.equal(calls, 1);
});

test("all private and ambiguous public asset spellings are denied before asset routing", () => {
  for (const path of [
    "/_question-packs",
    "/_question-packs/manifest.json",
    "/_QUESTION-PACKS/manifest.json",
    "/%5fquestion-packs/manifest.json",
    "/_question-packs%2fmanifest.json",
    "/%255fquestion-packs/manifest.json",
    "//_question-packs/manifest.json",
    "/foo/../_question-packs/manifest.json",
    "/foo/%2e%2e/_question-packs/manifest.json",
    "/foo%2f..%2f_question-packs/manifest.json",
    "/foo\\..\\_question-packs/manifest.json",
  ])
    assert.equal(privateAssetPath(new URL(`https://snapper.example${path}`).pathname), true, path);
  for (const path of [
    "/",
    "/index.html",
    "/assets/main-abc123.js",
    "/__grok/install.html",
    "/api/snapper/status",
  ])
    assert.equal(privateAssetPath(path), false, path);
});
