import { cp, mkdir, readFile, rm } from "node:fs/promises";
const root = new URL("../", import.meta.url);

/** Keep private packs out of public/ and Vite's browser build graph. */
export async function copyQuestionPacks(destination) {
  const source = new URL("data/questions/", root);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", source), "utf8"));
  if (manifest.version !== 1 || !manifest.total || !manifest.groups.length)
    throw new Error("Repository question pack is missing or invalid");
  const target = new URL("_question-packs/", destination);
  await rm(target, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, target, { recursive: true });
}

export async function prepareDevAssets(name = "dev-assets") {
  const destination = new URL(`.wrangler/${name}/`, root);
  await mkdir(destination, { recursive: true });
  await cp(new URL("public/", root), destination, { recursive: true });
  await copyQuestionPacks(destination);
  return destination.pathname;
}
