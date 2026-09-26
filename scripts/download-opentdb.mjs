/** Explicit maintenance command, never run during builds or games. */
import { mkdir, writeFile } from "node:fs/promises";
const directory = new URL("../.question-cache/", import.meta.url);
await mkdir(directory, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`OpenTDB returned ${response.status}`);
  return response.json();
}
const counts = await json("https://opentdb.com/api_count_global.php");
const total = counts.overall.total_num_of_verified_questions;
await wait(5500);
const token = await json("https://opentdb.com/api_token.php?command=request");
if (token.response_code !== 0) throw new Error("Could not get OpenTDB session token");
const rows = [];
let retries = 0;
while (rows.length < total) {
  await wait(5500); // Official limit: one request per IP every five seconds.
  const url = new URL("https://opentdb.com/api.php");
  url.searchParams.set("amount", String(Math.min(50, total - rows.length)));
  url.searchParams.set("token", token.token);
  url.searchParams.set("encode", "url3986");
  const data = await json(url);
  if (data.response_code === 5 && retries++ < 5) continue;
  if (data.response_code !== 0)
    throw new Error(`OpenTDB response ${data.response_code} after ${rows.length} questions`);
  retries = 0;
  rows.push(...data.results);
  await writeFile(
    new URL("opentdb.json", directory),
    JSON.stringify({
      source: "https://opentdb.com/api_config.php",
      retrievedAt: new Date().toISOString(),
      expected: total,
      results: rows,
    }),
  );
  console.log(`OpenTDB: ${rows.length}/${total}`);
}
