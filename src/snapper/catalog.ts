import { CLUES, GROUPS, SEQUENCES, SHORTS, TOSSUPS } from "./bank.ts";
import type { Format, PlayerView, QuestionAtom, QuestionBundle, RoomConfig } from "./protocol.ts";

/** Injected by the server; browser code must never import a repository pack. */
export type RepositoryQuestionLoader = (
  format: "tossup" | "snapper",
  config: RoomConfig,
  usedIds: readonly string[],
  count: number,
  random: () => number,
) => Promise<QuestionAtom[]>;

/** Content identity ignores provider IDs, punctuation and harmless spacing. */
export function contentId(text: string): string {
  const value = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
  }
  return `q-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
const identified = (q: QuestionAtom): QuestionAtom => ({
  ...q,
  id: contentId(q.clues?.join(" ") ?? q.text),
});
const one = (format: Format, title: string, q: QuestionAtom): QuestionBundle => ({
  id: `${format}-${q.id}`,
  format,
  title,
  atoms: [q],
});
const randomIndex = (length: number, random: () => number) =>
  Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
const eligible = (q: QuestionAtom, config: RoomConfig, used: Set<string>) =>
  !used.has(q.id) &&
  config.categories.includes(q.category as RoomConfig["categories"][number]) &&
  q.language === config.language &&
  (config.difficulty === "any" || config.difficulty === q.difficulty);
export function bundleSize(format: Format, config: RoomConfig, players: PlayerView[]): number {
  const active = players.filter(
    (p) => p.connected && p.role === "player" && (config.mode === "ffa" || p.team),
  );
  const largest = Math.max(
    active.filter((p) => p.team === "A").length,
    active.filter((p) => p.team === "B").length,
  );
  if (format === "assigned") return config.mode === "teams" ? 2 * largest : active.length;
  if (format === "shootout")
    return config.mode === "teams" ? Math.max(12, 4 * largest) : Math.max(12, 2 * active.length);
  return 1;
}
export function bundledOptions(
  format: Format,
  config: RoomConfig,
  usedIds: string[],
  players: PlayerView[],
  random: () => number = Math.random,
): QuestionBundle[] {
  const seen = new Set(usedIds);
  const usable = (q: QuestionAtom) => eligible(q, config, seen);
  if (format === "open" || format === "team")
    return GROUPS.map((group) => ({
      ...group,
      id: `${format}-${group.id}`,
      format,
      title: format === "team" ? `${group.title} · scramble & bonuses` : group.title,
      atoms: group.atoms.map(identified),
    })).filter(
      (group) => (format !== "team" || group.atoms.length === 4) && group.atoms.every(usable),
    );
  const pool = (
    format === "tossup"
      ? TOSSUPS
      : format === "sequence"
        ? SEQUENCES
        : format === "clues"
          ? CLUES
          : SHORTS
  )
    .map(identified)
    .filter(usable);
  if (format === "assigned" || format === "shootout") {
    const count = bundleSize(format, config, players);
    if (!count || pool.length < count) return [];
    const atoms = shuffled(pool, random).slice(0, count);
    return [
      {
        id: `${format}-${atoms[0]!.id}`,
        format,
        title: format === "assigned" ? "Your turn" : "Shootout",
        atoms,
      },
    ];
  }
  return pool.map((q) =>
    one(
      format,
      format === "clues"
        ? "Who / What am I?"
        : format === "sequence"
          ? "Put it in order"
          : format === "tossup"
            ? "Long tossup"
            : "Quick snapper",
      q,
    ),
  );
}
async function getJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(1800),
    headers: { Accept: "application/json" },
  });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 750_000)
    throw new Error("Question source unavailable");
  const text = await response.text();
  if (text.length > 750_000) throw new Error("Question source response too large");
  return JSON.parse(text);
}
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const plain = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
const qbCategories: Record<string, string> = {
  Science: "Science",
  History: "History",
  Literature: "Literature",
  Arts: "Fine Arts",
  Geography: "Geography",
};
export function parseQB(
  value: unknown,
  difficulty: "easy" | "medium" | "hard",
): QuestionAtom | null {
  const row = record(value);
  if (
    !row ||
    typeof row.question_sanitized !== "string" ||
    typeof row.answer_sanitized !== "string" ||
    typeof row.category !== "string"
  )
    return null;
  const answer = plain(row.answer_sanitized);
  // Complex quizbowl answerlines need human curation, never guess their rules.
  if (
    !answer ||
    answer.length > 100 ||
    /[[\]();{}]|\b(?:accept|prompt|reject|before|until|equivalent|either|or)\b|&[a-z#]/i.test(
      answer,
    )
  )
    return null;
  const category = Object.keys(qbCategories).find((key) => qbCategories[key] === row.category);
  if (!category) return null;
  const raw = plain(row.question_sanitized);
  if (raw.length < 30 || raw.length > 3500 || /&[a-z#]/i.test(raw)) return null;
  const marker = raw.indexOf("(*)");
  const text = raw.replace("(*)", " ").replace(/\s+/g, " ");
  const set = record(row.set);
  const packet = record(row.packet);
  const sourceParts = [
    "QB Reader",
    typeof set?.name === "string" ? set.name.slice(0, 160) : null,
    typeof packet?.name === "string"
      ? `${packet.name.slice(0, 160)}${Number.isInteger(packet.number) ? ` (packet ${packet.number})` : ""}`
      : Number.isInteger(packet?.number)
        ? `Packet ${packet!.number}`
        : null,
    Number.isInteger(row.number) ? `Question ${row.number}` : null,
  ];
  return {
    id: contentId(text),
    text,
    category,
    language: "en",
    difficulty,
    answer: { canonical: answer, aliases: [] },
    ...(marker >= 0 ? { powerAt: raw.slice(0, marker).replace(/\s+/g, " ").trim().length } : {}),
    provenance: {
      label: sourceParts.filter(Boolean).join(" · "),
      url:
        typeof row._id === "string" && /^[a-f\d]{24}$/i.test(row._id)
          ? `https://www.qbreader.org/api/tossup?_id=${encodeURIComponent(row._id)}`
          : "https://www.qbreader.org/",
      license: "Question authors retain copyright; retrieved live for noncommercial play",
    },
  };
}
const triviaCategories: Record<string, number[]> = {
  Science: [17, 18],
  Math: [19],
  History: [23],
  Literature: [10],
  Arts: [25],
  Geography: [22],
  Sport: [21],
};
export function parseTrivia(value: unknown, category: string): QuestionAtom | null {
  const row = record(value);
  if (
    !row ||
    row.type !== "multiple" ||
    typeof row.question !== "string" ||
    typeof row.correct_answer !== "string" ||
    !["easy", "medium", "hard"].includes(String(row.difficulty))
  )
    return null;
  let text: string, answer: string;
  try {
    text = decodeURIComponent(row.question);
    answer = decodeURIComponent(row.correct_answer);
  } catch {
    return null;
  }
  // Removing options is safe only for a self-contained, positive question.
  if (
    text.length < 12 ||
    text.length > 600 ||
    answer.length > 100 ||
    /\b(following|these|those|pictured|shown|except|not|incorrect|false|all of|none of)\b|<[^>]+>/i.test(
      text,
    ) ||
    /\b(all of|none of|both|either)\b/i.test(answer)
  )
    return null;
  return {
    id: contentId(text),
    text,
    category,
    difficulty: row.difficulty as QuestionAtom["difficulty"],
    language: "en",
    answer: { canonical: answer, aliases: [] },
    provenance: {
      label: "Open Trivia DB · adapted for typed answers",
      url: "https://opentdb.com/",
      license: "CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/",
    },
  };
}
let triviaNextRequest = 0;
async function external(
  format: Format,
  config: RoomConfig,
  fetcher: typeof fetch,
  random: () => number,
  needed: number,
): Promise<QuestionAtom[]> {
  // A provider's guessed rating must never substitute for explicitly unrated content.
  if (config.difficulty === "unrated") return [];
  if (format === "tossup") {
    const categories = config.categories.filter((c) => qbCategories[c]);
    if (!categories.length) return [];
    const difficulty = config.difficulty === "any" ? "medium" : config.difficulty;
    const url = new URL("https://www.qbreader.org/api/random-tossup");
    url.searchParams.set("number", "8");
    url.searchParams.set(
      "difficulties",
      config.difficulty === "any" ? "2,3,4" : String({ easy: 2, medium: 3, hard: 4 }[difficulty]),
    );
    url.searchParams.set("categories", categories.map((c) => qbCategories[c]).join(","));
    const json = record(await getJson(url, fetcher));
    return Array.isArray(json?.tossups)
      ? json.tossups
          .map((q) => {
            const nativeDifficulty = Number(record(q)?.difficulty);
            return parseQB(
              q,
              config.difficulty === "any" && Number.isFinite(nativeDifficulty)
                ? nativeDifficulty <= 2
                  ? "easy"
                  : nativeDifficulty >= 4
                    ? "hard"
                    : "medium"
                : difficulty,
            );
          })
          .filter((q): q is QuestionAtom => q !== null)
      : [];
  }
  if (!["snapper", "assigned", "shootout"].includes(format) || Date.now() < triviaNextRequest)
    return [];
  const categories = config.categories.filter((c) => triviaCategories[c]);
  if (!categories.length) return [];
  const category = categories[randomIndex(categories.length, random)]!;
  const ids = triviaCategories[category]!;
  const url = new URL("https://opentdb.com/api.php");
  // OpenTDB returns no results when the requested amount exceeds the matching
  // pool. Ask for this block's demand, not an arbitrary maximum-size batch.
  url.searchParams.set("amount", String(Math.min(50, Math.max(1, needed))));
  url.searchParams.set("type", "multiple");
  url.searchParams.set("encode", "url3986");
  url.searchParams.set("category", String(ids[randomIndex(ids.length, random)]));
  if (config.difficulty !== "any") url.searchParams.set("difficulty", config.difficulty);
  triviaNextRequest = Date.now() + 5100;
  const json = record(await getJson(url, fetcher));
  return json?.response_code === 0 && Array.isArray(json.results)
    ? json.results.map((q) => parseTrivia(q, category)).filter((q): q is QuestionAtom => q !== null)
    : [];
}
export async function selectBundle(
  config: RoomConfig,
  usedIds: string[],
  players: PlayerView[],
  fetcher: typeof fetch = fetch,
  random: () => number = Math.random,
  repository?: RepositoryQuestionLoader,
): Promise<{ bundle: QuestionBundle | null; message?: string }> {
  const active = players.filter((p) => p.connected && p.role === "player");
  if (!active.length)
    return { bundle: null, message: "A player needs to take a seat before play can continue." };
  const bothTeams = active.some((p) => p.team === "A") && active.some((p) => p.team === "B");
  const formats = shuffled(
    config.formats
      .filter((f) => f !== "team" || (config.mode === "teams" && bothTeams))
      .filter((f) => config.mode !== "teams" || !["assigned", "shootout"].includes(f) || bothTeams),
    random,
  );
  const used = new Set(usedIds);
  const unique = (questions: QuestionAtom[], seen: Set<string>) => [
    ...new Map(
      questions
        .map(identified)
        .filter((q) => eligible(q, config, seen))
        .map((q) => [q.id, q]),
    ).values(),
  ];
  const localAtoms = async (format: Format, count: number, extraUsed: string[] = []) => {
    const seen = new Set([...usedIds, ...extraUsed]);
    let questions: QuestionAtom[] = [];
    if (repository) {
      try {
        questions = unique(
          await repository(
            format === "tossup" ? "tossup" : "snapper",
            config,
            [...seen],
            count,
            random,
          ),
          seen,
        );
      } catch {
        // The original authored bank keeps local play usable if deploy assets are missing.
      }
    }
    return unique(
      [...questions, ...shuffled(format === "tossup" ? TOSSUPS : SHORTS, random)],
      seen,
    ).slice(0, count);
  };
  const block = (format: Format, atoms: QuestionAtom[]): QuestionBundle => ({
    id: `${format}-${atoms[0]!.id}`,
    format,
    title:
      format === "assigned"
        ? "Your turn"
        : format === "shootout"
          ? "Shootout"
          : format === "tossup"
            ? "Long tossup"
            : "Quick snapper",
    atoms,
  });
  let fallback = false;
  for (const format of formats) {
    const count = bundleSize(format, config, players);
    if (config.source === "mixed") {
      try {
        const live = unique(await external(format, config, fetcher, random, count), used);
        if (live.length && ["assigned", "shootout"].includes(format)) {
          const pool = [
            ...live,
            ...(live.length < count
              ? await localAtoms(
                  format,
                  count - live.length,
                  live.map((q) => q.id),
                )
              : []),
          ];
          if (pool.length >= count) return { bundle: block(format, pool.slice(0, count)) };
        } else if (live.length)
          return {
            bundle: one(
              format,
              format === "tossup" ? "Long tossup" : "Quick snapper",
              live[randomIndex(live.length, random)]!,
            ),
          };
      } catch {
        fallback = true;
      }
    }
    const loaded = ["tossup", "snapper", "assigned", "shootout"].includes(format)
      ? await localAtoms(format, count)
      : [];
    const local =
      loaded.length && loaded.length >= count
        ? [block(format, loaded)]
        : bundledOptions(format, config, usedIds, players, random);
    if (local.length)
      return {
        bundle: local[randomIndex(local.length, random)]!,
        ...(fallback
          ? { message: "The question service is unavailable. Playing from the bundled pack." }
          : {}),
      };
  }
  return {
    bundle: null,
    message:
      "No unseen questions remain for the enabled formats and filters. The owner can change settings or end this session.",
  };
}
