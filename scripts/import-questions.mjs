/** Rebuild playable packs offline from checked-in licensed source snapshots. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLUES, SEQUENCES, SHORTS, TOSSUPS } from "../src/snapper/bank.ts";
import { contentId } from "../src/snapper/catalog.ts";
import { judgeAnswer, normalizeAnswer } from "../src/snapper/judge.ts";
import {
  openTriviaCategories,
  opentdbCategories,
  parseOpenTriviaFile,
  qantaAtom,
  shortAtom,
} from "./question-import.mjs";

const root = new URL("../", import.meta.url);
const sources = new URL("data/sources/", root);
const out = new URL("data/questions/", root);
const sourceManifest = JSON.parse(await readFile(new URL("manifest.json", sources), "utf8"));
for (const source of sourceManifest.files) {
  const bytes = await readFile(new URL(source.file, sources));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== source.sha256) throw new Error(`Source checksum mismatch: ${source.file}`);
}
const imported = new Map();
const conflicting = new Set();
const originalIds = new Set(
  [...TOSSUPS, ...SHORTS, ...CLUES, ...SEQUENCES].map((q) =>
    contentId(q.clues?.join(" ") ?? q.text),
  ),
);
const stats = {};
function accept(atom, format, source) {
  if (!atom || [atom.answer.canonical, ...atom.answer.aliases].some((value) => judgeAnswer(value, atom.answer) !== "accept")) {
    stats[source].rejected++;
    return;
  }
  if (originalIds.has(atom.id) || conflicting.has(atom.id)) {
    stats[source].duplicates++;
    return;
  }
  const previous = imported.get(atom.id);
  if (previous) {
    if (
      normalizeAnswer(previous.atom.answer.canonical) !== normalizeAnswer(atom.answer.canonical)
    ) {
      imported.delete(atom.id);
      conflicting.add(atom.id);
      stats[previous.source].imported--;
      stats[previous.source].rejected++;
      stats[source].rejected++;
    } else stats[source].duplicates++;
    return;
  }
  imported.set(atom.id, { atom, format, source });
  stats[source].imported++;
}
function start(source, raw) {
  stats[source] = { raw, imported: 0, rejected: 0, duplicates: 0 };
}

// OpenTDB supplies difficulty; prefer it over duplicate unrated versions.
const trivia = JSON.parse(gunzipSync(await readFile(new URL("opentdb.json.gz", sources))));
if (trivia.results.length !== trivia.expected) throw new Error("OpenTDB snapshot is incomplete");
start("opentdb", trivia.results.length);
for (const row of trivia.results) {
  let atom = null;
  if (row.type === "multiple") {
    const category = opentdbCategories[decodeURIComponent(row.category)];
    if (category)
      atom = shortAtom(
        decodeURIComponent(row.question),
        decodeURIComponent(row.correct_answer),
        category,
        row.difficulty,
        {
          label: "Open Trivia DB · PixelTail Games and contributors · adapted for typed answers",
          url: "https://opentdb.com/",
          license:
            "CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/ · choices removed; text normalized",
        },
      );
  }
  accept(atom, "snapper", "opentdb");
}

for (const source of sourceManifest.files.filter((s) => s.file.startsWith("qanta."))) {
  const dataset = JSON.parse(gunzipSync(await readFile(new URL(source.file, sources))));
  if (dataset.version !== "2018.04.18") throw new Error("Unexpected QANTA dataset version");
  const split = source.file.split(".")[1];
  const key = `qanta-${split}`;
  start(key, dataset.questions.length);
  for (const row of dataset.questions) accept(qantaAtom(row, split), "tossup", key);
}

// Read only known category members from the pinned archive; no extraction or
// execution of upstream code is involved in the offline importer.
const archive = fileURLToPath(new URL("opentriviaqa.tar.gz", sources));
const prefix = `OpenTriviaQA-${sourceManifest.openTriviaRevision}/categories/`;
start("opentriviaqa", 0);
for (const [name, category] of Object.entries(openTriviaCategories)) {
  const result = spawnSync("tar", ["-xOf", archive, `${prefix}${name}`], {
    encoding: "utf8",
    maxBuffer: 8_000_000,
  });
  if (result.status !== 0) throw new Error(`Cannot read OpenTriviaQA category ${name}`);
  const parsed = parseOpenTriviaFile(result.stdout);
  stats.opentriviaqa.raw += parsed.count;
  stats.opentriviaqa.rejected += parsed.count - parsed.rows.length;
  for (const row of parsed.rows)
    accept(
      shortAtom(row.text, row.answer, category, "unrated", {
        label: `OpenTriviaQA · uberspot and contributors · ${name} #${row.number} · adapted for typed answers`,
        url: `https://github.com/uberspot/OpenTriviaQA/blob/${sourceManifest.openTriviaRevision}/categories/${name}`,
        license:
          "CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/ · choices removed; whitespace normalized",
      }),
      "snapper",
      "opentriviaqa",
    );
}

const buckets = new Map();
for (const { atom, format } of imported.values()) {
  const slug = atom.category.toLowerCase().replaceAll(" ", "-");
  const key = `${format}/${slug}/${atom.difficulty}`;
  if (!buckets.has(key))
    buckets.set(key, { format, category: atom.category, difficulty: atom.difficulty, atoms: [] });
  buckets.get(key).atoms.push(atom);
}
// This is generated output only. The source snapshots and their licenses live
// in a different directory and are never touched here.
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const groups = [];
for (const [key, bucket] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
  bucket.atoms.sort((a, b) => a.id.localeCompare(b.id));
  const directory = new URL(`${key}/`, out);
  await mkdir(directory, { recursive: true });
  const shards = [];
  for (let i = 0; i < bucket.atoms.length; i += 128) {
    const atoms = bucket.atoms.slice(i, i + 128);
    const path = `${key}/${String(i / 128).padStart(4, "0")}.json`;
    await writeFile(
      new URL(path, out),
      `[\n${atoms.map((q) => JSON.stringify(q)).join(",\n")}\n]\n`,
    );
    shards.push({ path, ids: atoms.map((q) => q.id) });
  }
  const index = `${key}/index.json`;
  await writeFile(new URL(index, out), JSON.stringify({ shards }) + "\n");
  groups.push({
    format: bucket.format,
    category: bucket.category,
    difficulty: bucket.difficulty,
    index,
    count: bucket.atoms.length,
  });
}
const manifest = {
  version: 1,
  total: imported.size,
  conflictingPrompts: conflicting.size,
  groups,
  sources: stats,
};
await writeFile(new URL("manifest.json", out), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({ total: imported.size, groups: groups.length, sources: stats }, null, 2),
);
