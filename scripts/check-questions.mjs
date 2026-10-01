import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { CATEGORIES, DEFAULT_CONFIG } from "../src/snapper/protocol.ts";
import { contentId } from "../src/snapper/catalog.ts";
import { judgeAnswer } from "../src/snapper/judge.ts";
import { QuestionPacks, QUESTION_PACK_PREFIX } from "../worker/question-packs.ts";
const root = new URL("../data/questions/", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const manifest = await json("manifest.json");
const ids = new Set();
let shardCount = 0;
let bytes = 0;
for (const group of manifest.groups) {
  assert.ok(CATEGORIES.includes(group.category));
  assert.ok(["tossup", "snapper"].includes(group.format));
  const index = await json(group.index);
  let count = 0;
  for (const shard of index.shards) {
    assert.match(shard.path, /^[a-z0-9/_-]+\.json$/);
    const atoms = await json(shard.path);
    const size = (await stat(new URL(shard.path, root))).size;
    assert.ok(size < 1024 * 1024, `Oversize shard: ${shard.path}`);
    bytes += size;
    shardCount++;
    assert.deepEqual(
      atoms.map((q) => q.id),
      shard.ids,
    );
    assert.ok(atoms.length > 0 && atoms.length <= 128);
    for (const q of atoms) {
      assert.equal(ids.has(q.id), false, `Duplicate question: ${q.id}`);
      ids.add(q.id);
      assert.equal(q.id, contentId(q.text));
      assert.equal(q.category, group.category);
      assert.equal(q.difficulty, group.difficulty);
      assert.equal(q.language, "en");
      const expectedLicense = q.provenance.label.startsWith("The Trivia API ·")
        ? "CC BY-NC 4.0 — https://creativecommons.org/licenses/by-nc/4.0/"
        : q.provenance.label.startsWith("LearnClash ·")
          ? "CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/"
          : "CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/";
      assert.ok(q.provenance.license.startsWith(expectedLicense), `Incorrect license: ${q.id}`);
      assert.ok(q.provenance.url.startsWith("https://"));
      assert.equal(
        judgeAnswer(q.answer.canonical, q.answer),
        "accept",
        `Invalid answer key: ${q.id}`,
      );
      for (const alias of q.answer.aliases)
        assert.equal(judgeAnswer(alias, q.answer), "accept", `Invalid alias: ${q.id}`);
      for (const rejected of q.answer.rejects ?? [])
        assert.equal(judgeAnswer(rejected, q.answer), "reject", `Invalid reject: ${q.id}`);
      assert.equal(/\(\*\)|\(\*\*\)|\b(?:ANSWER|ANS)\s*:/i.test(q.text), false, q.id);
      if (q.powerAt !== undefined) assert.ok(q.powerAt > 0 && q.powerAt < q.text.length);
    }
    count += atoms.length;
  }
  assert.equal(count, group.count);
}
assert.equal(ids.size, manifest.total);
assert.equal(
  Object.values(manifest.sources).reduce((sum, source) => sum + source.imported, 0),
  manifest.total,
);
for (const source of Object.values(manifest.sources))
  assert.equal(source.raw, source.imported + source.rejected + source.duplicates);
assert.ok(shardCount + manifest.groups.length + 100 < 20000, "Free static-file allowance");

// Exercise the actual bounded Worker loader against every generated group, not
// only the importer's JSON structure. This catches schema/cache/filter drift.
const packs = new QuestionPacks({
  async fetch(input) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = url.pathname.slice(`${QUESTION_PACK_PREFIX}/`.length);
    return new Response(await readFile(new URL(path, root)), {
      headers: { "Content-Type": "application/json" },
    });
  },
});
for (const group of manifest.groups) {
  const config = {
    ...DEFAULT_CONFIG,
    source: "bundled",
    categories: [group.category],
    difficulty: group.difficulty,
  };
  const selected = await packs.select(group.format, config, [], 1, () => 0.5);
  assert.equal(selected.length, 1, `Worker cannot load ${group.index}`);
  assert.equal(selected[0].category, group.category);
  assert.equal(selected[0].difficulty, group.difficulty);
  const next = await packs.select(group.format, config, [selected[0].id], 1, () => 0.5);
  assert.equal(next.length, group.count > 1 ? 1 : 0);
  assert.notEqual(next[0]?.id, selected[0].id);
}
console.log(
  JSON.stringify({
    questions: ids.size,
    shards: shardCount,
    groups: manifest.groups.length,
    bytes,
    runtimeGroupsChecked: manifest.groups.length,
  }),
);
