import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { CATEGORIES } from "../src/snapper/protocol.ts";
import { contentId } from "../src/snapper/catalog.ts";
import { judgeAnswer } from "../src/snapper/judge.ts";
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
      assert.match(q.provenance.license, /CC BY-SA 4.0/);
      assert.ok(q.provenance.url.startsWith("https://"));
      assert.equal(
        judgeAnswer(q.answer.canonical, q.answer),
        "accept",
        `Invalid answer key: ${q.id}`,
      );
      assert.equal(/\(\*\)|\(\*\*\)|\b(?:ANSWER|ANS)\s*:/i.test(q.text), false, q.id);
      if (q.powerAt !== undefined) assert.ok(q.powerAt > 0 && q.powerAt < q.text.length);
    }
    count += atoms.length;
  }
  assert.equal(count, group.count);
}
assert.equal(ids.size, manifest.total);
assert.ok(shardCount + manifest.groups.length + 100 < 20000, "Free static-file allowance");
console.log(
  JSON.stringify({
    questions: ids.size,
    shards: shardCount,
    groups: manifest.groups.length,
    bytes,
  }),
);
