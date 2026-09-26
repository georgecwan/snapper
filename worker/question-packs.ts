import { z } from "zod";
import { CATEGORIES, type QuestionAtom } from "../src/snapper/protocol.ts";
import { contentId, type RepositoryQuestionLoader } from "../src/snapper/catalog.ts";

export const QUESTION_PACK_PREFIX = "/_question-packs";

/** Asset names in this app are ASCII. Reject ambiguous spellings before the
 * asset router can decode or normalize them differently from this Worker. */
export function privateAssetPath(pathname: string): boolean {
  return (
    pathname.toLowerCase().startsWith(QUESTION_PACK_PREFIX) ||
    pathname.includes("%") ||
    pathname.includes("\\") ||
    pathname.includes("//")
  );
}

const relativePath = z
  .string()
  .max(240)
  .regex(/^[a-z0-9][a-z0-9/_-]*\.json$/)
  .refine((value) => !value.includes("//"));
const difficulty = z.enum(["easy", "medium", "hard", "unrated"]);
const groupSchema = z.object({
  format: z.enum(["tossup", "snapper"]),
  category: z.enum(CATEGORIES),
  difficulty,
  index: relativePath,
  count: z.number().int().min(1).max(2_000_000),
});
const manifestSchema = z.object({
  version: z.literal(1),
  total: z.number().int().min(0).max(2_000_000),
  groups: z.array(groupSchema).max(128),
});
const idSchema = z.string().min(1).max(100);
const indexSchema = z.object({
  shards: z
    .array(z.object({ path: relativePath, ids: z.array(idSchema).min(1).max(128) }))
    .max(20_000),
});
const answerStrings = z.array(z.string().min(1).max(300)).max(40);
const atomSchema = z.object({
  id: idSchema,
  text: z.string().min(1).max(10_000),
  category: z.enum(CATEGORIES),
  difficulty,
  language: z.literal("en"),
  answer: z.object({
    canonical: z.string().min(1).max(300),
    aliases: answerStrings,
    promptAliases: answerStrings.optional(),
    rejects: answerStrings.optional(),
    orderedItems: z.array(answerStrings).max(20).optional(),
  }),
  provenance: z.object({
    label: z.string().min(1).max(1000),
    url: z.string().url().max(2048).optional(),
    license: z.string().min(1).max(2000),
    authors: z.string().max(2000).optional(),
  }),
  powerAt: z.number().int().min(0).optional(),
  clues: z.tuple([z.string(), z.string(), z.string(), z.string()]).optional(),
});
type Group = z.infer<typeof groupSchema>;
type Manifest = z.infer<typeof manifestSchema>;
type PackIndex = z.infer<typeof indexSchema>;
type Assets = { fetch(input: Request | string): Promise<Response> };
interface LocatedQuestion {
  id: string;
  path: string;
}

/** Limit caches by both entry count and source bytes; a large corpus must never
 * become one eagerly parsed object graph in the 128 MiB Worker isolate. */
class BoundedCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  private maxEntries: number;
  private maxBytes: number;
  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes: number): void {
    if (bytes > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}

const randomIndex = (length: number, random: () => number) =>
  Math.min(length - 1, Math.max(0, Math.floor(random() * length)));

/** Select IDs first, so consumed questions do not cause wasted shard requests. */
function sample(
  index: PackIndex,
  used: Set<string>,
  count: number,
  random: () => number,
): { questions: LocatedQuestion[]; available: number } {
  const result: LocatedQuestion[] = [];
  let available = 0;
  for (const shard of index.shards)
    for (const id of shard.ids) {
      if (used.has(id)) continue;
      const position = available < count ? available : randomIndex(available + 1, random);
      if (position < count) result[position] = { id, path: shard.path };
      available++;
    }
  return { questions: result, available };
}

/** Server-only immutable repository packs. Nothing here exposes an HTTP route. */
export class QuestionPacks {
  private assets: Assets;
  private manifest: Promise<Manifest | null> | null = null;
  private indexes = new BoundedCache<PackIndex>(8, 2 * 1024 * 1024);
  private shards = new BoundedCache<QuestionAtom[]>(8, 2 * 1024 * 1024);

  constructor(assets: Assets) {
    this.assets = assets;
  }

  private async read(path: string, maxBytes: number): Promise<{ value: unknown; bytes: number }> {
    // Use a fixed internal URL and fresh headers, never a participant's Request.
    const response = await this.assets.fetch(
      new Request(`https://questions.internal${QUESTION_PACK_PREFIX}/${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      }),
    );
    if (
      response.status !== 200 ||
      !response.headers.get("Content-Type")?.toLowerCase().includes("application/json") ||
      Number(response.headers.get("Content-Length") ?? 0) > maxBytes ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error("Repository question asset unavailable");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw new Error("Repository question asset is too large");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return { value: JSON.parse(text), bytes };
    } finally {
      await reader.cancel();
    }
  }

  private getManifest(): Promise<Manifest | null> {
    this.manifest ??= this.read("manifest.json", 128 * 1024)
      .then(({ value }) => manifestSchema.parse(value))
      .catch(() => null);
    return this.manifest;
  }

  private async getIndex(group: Group): Promise<PackIndex> {
    const cached = this.indexes.get(group.index);
    if (cached) return cached;
    const { value, bytes } = await this.read(group.index, 4 * 1024 * 1024);
    const index = indexSchema.parse(value);
    const ids = index.shards.flatMap((shard) => shard.ids);
    if (
      ids.length !== group.count ||
      new Set(ids).size !== ids.length ||
      new Set(index.shards.map((shard) => shard.path)).size !== index.shards.length
    )
      throw new Error("Repository question index is inconsistent");
    this.indexes.set(group.index, index, bytes);
    return index;
  }

  private async getShard(path: string): Promise<QuestionAtom[]> {
    const cached = this.shards.get(path);
    if (cached) return cached;
    const { value, bytes } = await this.read(path, 1024 * 1024);
    const atoms = z.array(atomSchema).min(1).max(128).parse(value);
    if (new Set(atoms.map((atom) => atom.id)).size !== atoms.length)
      throw new Error("Repository question shard repeats an identity");
    this.shards.set(path, atoms, bytes);
    return atoms;
  }

  readonly select: RepositoryQuestionLoader = async (format, config, usedIds, count, random) => {
    if (count < 1 || count > 32 || config.language !== "en") return [];
    const manifest = await this.getManifest();
    if (!manifest) return [];
    const groups: Array<Group & { remaining: number; choices?: LocatedQuestion[] }> =
      manifest.groups
        .filter(
          (group) =>
            group.format === format &&
            config.categories.includes(group.category) &&
            (config.difficulty === "any" || group.difficulty === config.difficulty),
        )
        .map((group) => ({ ...group, remaining: group.count }));
    const used = new Set(usedIds);
    const result: QuestionAtom[] = [];
    // Draw a group per question, then batch each group's demand. This keeps
    // multiplayer blocks varied without loading every matching index first.
    // Unloaded groups use manifest counts; loaded groups have exact unseen
    // counts. Exhausted groups are removed and any shortage is redistributed.
    while (groups.some((group) => group.remaining > 0) && result.length < count) {
      const demand = new Map<(typeof groups)[number], number>();
      for (let n = result.length; n < count; n++) {
        const weight = (group: (typeof groups)[number]) =>
          Math.max(0, group.remaining - (demand.get(group) ?? 0));
        const total = groups.reduce((sum, group) => sum + weight(group), 0);
        if (!total) break;
        let ticket = randomIndex(total, random);
        for (const group of groups) {
          const available = weight(group);
          if (ticket < available) {
            demand.set(group, (demand.get(group) ?? 0) + 1);
            break;
          }
          ticket -= available;
        }
      }
      for (const [group, needed] of demand) {
        try {
          if (!group.choices) {
            const index = await this.getIndex(group);
            const selected = sample(index, used, count, random);
            group.choices = selected.questions;
            group.remaining = selected.available;
          }
          const locations = group.choices.splice(0, needed);
          group.remaining -= locations.length;
          if (!group.choices.length) group.remaining = 0;
          const byPath = new Map<string, LocatedQuestion[]>();
          for (const location of locations)
            byPath.set(location.path, [...(byPath.get(location.path) ?? []), location]);
          for (const [path, wanted] of byPath) {
            const atoms = await this.getShard(path);
            for (const location of wanted) {
              const atom = atoms.find((candidate) => candidate.id === location.id);
              if (
                !atom ||
                used.has(atom.id) ||
                atom.category !== group.category ||
                atom.difficulty !== group.difficulty ||
                atom.id !== contentId(atom.clues?.join(" ") ?? atom.text) ||
                (atom.powerAt !== undefined && atom.powerAt > atom.text.length)
              )
                continue;
              result.push(atom);
              used.add(atom.id);
            }
          }
        } catch {
          group.remaining = 0;
          // Missing/invalid deploy assets use another suitable group or the
          // original curated pack. Never relax the owner's filters to fill gaps.
        }
      }
    }
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1, random);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  };
}
