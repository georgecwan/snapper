/** Pure, conservative conversions for redistributable repository question packs. */
import { contentId } from "../src/snapper/catalog.ts";
import { normalizeAnswer } from "../src/snapper/judge.ts";

const entities = {
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lt: "<",
  gt: ">",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  ndash: "–",
  mdash: "—",
  eacute: "é",
  Eacute: "É",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  deg: "°",
  pi: "π",
  hellip: "…",
};
export function cleanText(value) {
  return String(value ?? "")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code) => {
      if (!code.startsWith("#")) return entities[code] ?? whole;
      const n = Number.parseInt(
        code.slice(code[1]?.toLowerCase() === "x" ? 2 : 1),
        code[1]?.toLowerCase() === "x" ? 16 : 10,
      );
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    })
    .replace(/\\(['"])/g, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
const malformed = (value) =>
  [...value].some((character) => character.charCodeAt(0) < 32) ||
  /\ufffd|Ã.|Â.|â€|&(?:#\w+|[a-z]+);|<[^>]*>|\\|\p{L}\?\p{L}|";/iu.test(value);
const contextDependent =
  /\b(?:following|these|those|above|below|pictured|shown|image|photograph|diagram|clip|audio|except|incorrect|false|none of|all of|previous question)\b/i;
const timeDependent =
  /\b(?:currently|presently|at present|current|recent|recently|upcoming|newest|latest|this year|last year|next year|today|now|most recent|still alive|living person)\b/i;
const badAnswer = /\b(?:all of|none of|both|either|true|false|yes|no)\b|\.{3}|_{2,}|[[\]{}<>]/i;
function usableAnswer(answer) {
  return (
    !!answer &&
    !!normalizeAnswer(answer) &&
    answer.length <= 100 &&
    answer.split(" ").length <= 12 &&
    !malformed(answer) &&
    !badAnswer.test(answer)
  );
}
export function shortAtom(text, answer, category, difficulty, provenance) {
  text = cleanText(text);
  answer = cleanText(answer);
  if (
    text.length < 12 ||
    text.length > 650 ||
    malformed(text) ||
    contextDependent.test(text) ||
    timeDependent.test(text) ||
    /\bnot\b|\b(?:why|how do|how does|explain)\b|\b(?:ANSWER|ANS)\s*:|\(\*\)/i.test(text) ||
    !usableAnswer(answer)
  )
    return null;
  // A prose explanation or a comma-separated combination of choices is unsuitable
  // for an exact typed answer. No aliases are guessed from distractors.
  if (
    /^(?:because|to |it |they |by |when |if )/i.test(answer) ||
    (/\b(?:and|or)\b/.test(answer) && answer.split(" ").length > 7)
  )
    return null;
  return {
    id: contentId(text),
    text,
    answer: { canonical: answer, aliases: [] },
    category,
    difficulty,
    language: "en",
    provenance,
  };
}

/** Parse only explicitly stated, unconditional simple aliases/prompts/rejections. */
export function quizbowlAnswer(raw) {
  const text = cleanText(raw);
  if (
    !text ||
    malformed(text) ||
    /[{}<>/_]|\p{L}\s+[sS]\b|\b(?:before|after|until|equivalents?|word forms|in either order|any order|two answers|either order)\b/iu.test(
      text,
    )
  )
    return null;
  const match = /^([^[\]]+?)(?:\s*\[([^[\]]+)\])?$/.exec(text);
  if (!match) return null;
  const canonical = match[1].trim();
  if (!usableAnswer(canonical) || /[();]|=\s*$|\bor\b/i.test(canonical)) return null;
  const result = { canonical, aliases: [] };
  if (match[2]) {
    for (const clause of match[2].split(/\s*;\s*/)) {
      const instruction = /^(?:also )?(accept|or|prompt on|do not accept|reject)\s+(.+)$/i.exec(
        clause.trim(),
      );
      if (!instruction) return null;
      const value = instruction[2].trim().replace(/^[“"]|[”"]$/g, "");
      if (
        !usableAnswer(value) ||
        /\b(?:or|accept|prompt|reject|partial|anything|any|similar|equivalents?|surname|since|specific|specifically|synonyms?|clues?|buzz|sentences?|early|later|as|but|general|descriptions?|answers?|names?|other|order|only|enough|such|on|first|second|last|read|mentioned|mention|unless|if|just|with|words?|forms?|around|like|question|grudgingly|technically)\b|[();",]|\betc\./i.test(
          value,
        )
      )
        return null;
      const field = /prompt/i.test(instruction[1])
        ? "promptAliases"
        : /reject|do not/i.test(instruction[1])
          ? "rejects"
          : "aliases";
      (result[field] ??= []).push(value);
    }
  }
  return result;
}

const qbCategories = {
  History: "History",
  Literature: "Literature",
  Science: "Science",
  "Fine Arts": "Arts",
  "Social Science": "Social Science",
  Mythology: "Mythology",
  Trash: "Entertainment",
  Geography: "Geography",
  Philosophy: "Philosophy",
  Religion: "Religion",
};
const qbDifficulty = {
  MS: "easy",
  middle_school: "easy",
  easy_high_school: "easy",
  HS: "medium",
  regular_high_school: "medium",
  College: "hard",
  Open: "hard",
  open: "hard",
  regular_college: "hard",
  hard_college: "hard",
  easy_college: "hard",
  hard_high_school: "hard",
  national_high_school: "hard",
};
export function qantaAtom(row, split) {
  // This particular source batch repeatedly has fused words from extraction.
  if (row.tournament === "PACE NSC" && row.year === 2013 && row.dataset === "quizdb.org")
    return null;
  const category = qbCategories[row.category];
  if (!category) return null; // Unanchored current-events questions are not archived for play.
  const answer = quizbowlAnswer(row.answer);
  const raw = cleanText(row.text);
  if (
    !answer ||
    raw.length < 80 ||
    raw.length > 3500 ||
    malformed(raw) ||
    timeDependent.test(raw) ||
    /\b(?:photo|image|diagram|audio|video clip|this recording|FTPE|F10PE)\b|\b(?:ANSWER|ANS)\s*:/i.test(
      raw,
    ) ||
    raw.includes("(**)") ||
    raw.split("(*)").length > 2
  )
    return null;
  const marker = raw.indexOf("(*)");
  const text = raw.replace("(*)", "").replace(/\s+/g, " ").trim();
  return {
    id: contentId(text),
    text,
    answer,
    category,
    ...(marker > 0 ? { powerAt: raw.slice(0, marker).trimEnd().length } : {}),
    difficulty: qbDifficulty[row.difficulty] ?? "unrated",
    language: "en",
    provenance: {
      label:
        `QANTA 2018 · ${row.tournament ?? "Unknown tournament"} ${row.year ?? ""} · ${split} #${row.qanta_id}`.trim(),
      url: "https://pinafore.github.io/qanta-leaderboard/",
      license:
        "CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/ · text normalized; simple answer rules adapted",
      authors: `QANTA / original question authors; ${row.dataset ?? "unknown collection"}; source difficulty: ${row.difficulty ?? "unrated"}`,
    },
  };
}

export const openTriviaCategories = {
  animals: "Science",
  "brain-teasers": "General",
  celebrities: "Entertainment",
  entertainment: "Entertainment",
  "for-kids": "General",
  general: "General",
  geography: "Geography",
  history: "History",
  hobbies: "General",
  humanities: "General",
  literature: "Literature",
  movies: "Entertainment",
  music: "Arts",
  newest: "General",
  people: "General",
  rated: "General",
  "religion-faith": "Religion",
  "science-technology": "Science",
  sports: "Sport",
  television: "Entertainment",
  "video-games": "Entertainment",
  world: "General",
};
export function parseOpenTriviaFile(text) {
  const rows = [];
  const starts = [...text.matchAll(/^#Q\s+(.+)$/gm)];
  for (let index = 0; index < starts.length; index++) {
    const entry = text.slice(starts[index].index, starts[index + 1]?.index ?? text.length);
    const match = /^#Q\s+([\s\S]*?)\n\^\s+([^\n]+)\n([\s\S]*)$/.exec(entry);
    if (!match) continue;
    const choices = [...match[3].matchAll(/^[A-Z]\s+(.+)$/gm)].map((m) => cleanText(m[1]));
    const answer = cleanText(match[2]);
    if (choices.length < 2 || !choices.includes(answer)) continue;
    rows.push({ text: match[1], answer, number: index + 1 });
  }
  return { rows, count: starts.length };
}

export const opentdbCategories = {
  "General Knowledge": "General",
  "Entertainment: Books": "Literature",
  "Entertainment: Film": "Entertainment",
  "Entertainment: Music": "Arts",
  "Entertainment: Musicals & Theatres": "Arts",
  "Entertainment: Television": "Entertainment",
  "Entertainment: Video Games": "Entertainment",
  "Entertainment: Board Games": "Entertainment",
  "Science & Nature": "Science",
  "Science: Computers": "Science",
  "Science: Mathematics": "Math",
  Mythology: "Mythology",
  Sports: "Sport",
  Geography: "Geography",
  History: "History",
  Politics: "Social Science",
  Art: "Arts",
  Celebrities: "Entertainment",
  Animals: "Science",
  Vehicles: "General",
  "Entertainment: Comics": "Entertainment",
  "Science: Gadgets": "Science",
  "Entertainment: Japanese Anime & Manga": "Entertainment",
  "Entertainment: Cartoon & Animations": "Entertainment",
};
