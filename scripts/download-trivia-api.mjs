/** Explicit, bounded, resumable maintenance download; never used during play/build. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

const directory = new URL("../.question-cache/", import.meta.url);
await mkdir(directory, { recursive: true });
const target = new URL("the-trivia-api.json", directory);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--fresh"))
  throw new Error("Usage: download-trivia-api.mjs [--fresh]");
let previous;
try {
  if (!args.includes("--fresh")) previous = JSON.parse(await readFile(target, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const rows = new Map((previous?.results ?? []).map((row) => [row.id, row]));
const categories = [
  "science",
  "film_and_tv",
  "history",
  "society_and_culture",
  "sport_and_leisure",
  "general_knowledge",
  "geography",
  "food_and_drink",
  "music",
  "arts_and_literature",
];
const coverage = [];
let requests = 0;
const maxRequests = 2400;
async function json(path, query) {
  const url = new URL(path, "https://the-trivia-api.com/v2/");
  url.search = new URLSearchParams({ types: "text_choice", ...query }).toString();
  for (let retry = 0; retry < 4; retry++) {
    if (++requests > maxRequests)
      throw new Error("Maintenance request budget exhausted; saved progress can be resumed");
    // The public endpoint advertises 20 requests / 5 seconds. Stay below half
    // that rate, sequentially; never send credentials or access paid endpoints.
    await wait(550);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (error) {
      if (retry === 3) throw error;
      await wait(5000 * (retry + 1));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const delay = Number(response.headers.get("retry-after"));
      await wait(
        Math.min(120000, Math.max(5000 * (retry + 1), Number.isFinite(delay) ? delay * 1000 : 0)),
      );
      continue;
    }
    if (!response.ok) throw new Error(`The Trivia API returned ${response.status}`);
    return response.json();
  }
  throw new Error("The Trivia API remained unavailable after bounded retries");
}
async function save() {
  const temporary = new URL("the-trivia-api.json.tmp", directory);
  await writeFile(
    temporary,
    JSON.stringify({
      source: "https://the-trivia-api.com/",
      retrievedAt: new Date().toISOString(),
      complete: false,
      requests,
      coverage,
      results: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
  await rename(temporary, target);
}
for (const category of categories) {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const query = { categories: category, difficulties: difficulty };
    const metadata = await json("metadata", query);
    const expected = metadata.byState?.approved;
    if (!Number.isSafeInteger(expected) || expected < 0) throw new Error("Invalid provider count");
    let count = () =>
      [...rows.values()].filter((q) => q.category === category && q.difficulty === difficulty)
        .length;
    let stale = 0;
    let batches = 0;
    while (count() < expected && stale < 16 && batches < Math.ceil(expected / 50) * 12 + 16) {
      const batch = await json("questions", { ...query, limit: String(Math.min(50, expected)) });
      if (!Array.isArray(batch) || batch.length > 50) throw new Error("Invalid provider batch");
      const before = rows.size;
      for (const row of batch) {
        if (
          typeof row.id !== "string" ||
          row.type !== "text_choice" ||
          row.category !== category ||
          row.difficulty !== difficulty
        )
          throw new Error("Provider ignored the requested filters");
        rows.set(row.id, row);
      }
      stale = rows.size === before ? stale + 1 : 0;
      batches++;
      if (batches % 10 === 0) await save();
    }
    coverage.push({ category, difficulty, expected, downloaded: count(), batches });
    await save();
    console.log(
      `${category}/${difficulty}: ${count()}/${expected}; ${rows.size} total; ${requests} requests`,
    );
  }
}
console.log(
  `Saved ${rows.size} unique source records. Counts are a snapshot, not a completeness guarantee.`,
);
