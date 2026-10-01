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

// Protobowl's source answerlines use {braces} for required (bold) words.
// Keep the full display answer and an alias containing ALL marked spans. Never
// treat separate spans as independent alternatives or discard numeric qualifiers.
function markedPhrase(raw) {
  const spans = [...raw.matchAll(/\{([^{}]+)\}/g)];
  if (/[{}]/.test(raw.replace(/\{[^{}]+\}/g, ""))) return null;
  const full = cleanText(raw.replace(/\{([^{}]+)\}/g, "$1"));
  const required = cleanText(spans.map((span) => span[1]).join(" "));
  if (!usableAnswer(full) || (spans.length && !usableAnswer(required))) return null;
  return {
    full,
    required: required && normalizeAnswer(required) !== normalizeAnswer(full) ? required : null,
  };
}

/** Parse only explicitly stated, unconditional simple aliases/prompts/rejections. */
export function quizbowlAnswer(raw) {
  const text = cleanText(raw);
  if (
    !text ||
    malformed(text) ||
    /[<>/_]|\p{L}\s+[sS]\b|\b(?:before|after|until|equivalents?|word forms|in either order|any order|two answers|either order)\b/iu.test(
      text,
    )
  )
    return null;
  const match = /^([^[\]]+?)(?:\s*\[([^[\]]+)\])?$/.exec(text);
  if (!match) return null;
  const canonical = markedPhrase(match[1].trim());
  if (
    !canonical ||
    /[();]|=\s*$|\b(?:or|accept|prompt|reject)\b|\b(?:ANSWER|ANS)\s*:/i.test(canonical.full)
  )
    return null;
  const result = {
    canonical: canonical.full,
    aliases: canonical.required ? [canonical.required] : [],
  };
  if (match[2]) {
    for (const clause of match[2].split(/\s*;\s*/)) {
      const instruction = /^(?:also )?(accept|or|prompt on|do not accept|reject)\s+(.+)$/i.exec(
        clause.trim(),
      );
      if (!instruction) return null;
      const phrase = markedPhrase(instruction[2].trim().replace(/^[“"]|[”"]$/g, ""));
      if (!phrase) return null;
      const value = phrase.full;
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
      if (phrase.required) result[field].push(phrase.required);
    }
  }
  return result;
}

export const triviaApiCategories = {
  science: "Science",
  film_and_tv: "Entertainment",
  history: "History",
  society_and_culture: "Social Science",
  sport_and_leisure: "Sport",
  general_knowledge: "General",
  geography: "Geography",
  food_and_drink: "General",
  music: "Arts",
  arts_and_literature: "Arts",
};
export function triviaApiAtom(row, review = {}) {
  if (
    !row ||
    row.type !== "text_choice" ||
    typeof row.id !== "string" ||
    !/^[a-f0-9]{24}$/.test(row.id) ||
    typeof row.question?.text !== "string" ||
    typeof row.correctAnswer !== "string" ||
    !Object.hasOwn(triviaApiCategories, row.category) ||
    !["easy", "medium", "hard"].includes(row.difficulty) ||
    (row.language !== undefined && row.language !== "en") ||
    !Array.isArray(row.incorrectAnswers) ||
    row.incorrectAnswers.length !== 3 ||
    row.incorrectAnswers.some(
      (a) =>
        typeof a !== "string" ||
        !a.trim() ||
        normalizeAnswer(a) === normalizeAnswer(row.correctAnswer),
    )
  )
    return null;
  const decision = review[row.id];
  if (
    decision &&
    (row.question.text !== decision.originalQuestion ||
      row.correctAnswer !== decision.originalAnswer)
  )
    throw new Error(`The Trivia API review no longer matches question ${row.id}`);
  if (decision?.exclude) return null;
  // Subjective superlatives and explanatory answer annotations do not give a
  // reliable single typed answer. Changing records need a year in the prompt.
  if (
    /[()]/.test(row.correctAnswer) ||
    /\blyrics?\b|\bsong (?:begins|opens) with\b/i.test(row.question.text) ||
    /\bwhich (?:book|novel) contains (?:the )?character\b|\bin which book does\b/i.test(
      row.question.text,
    ) ||
    /\b(?:most famous|most influential|most popular|greatest)\b/i.test(row.question.text) ||
    (/\b(?:highest[- ]grossing|best[- ]selling|richest|tallest building|most populous|has won the most|produces the most)\b/i.test(
      row.question.text,
    ) &&
      !/\b(?:1\d{3}|20\d{2})\b/.test(row.question.text))
  )
    return null;
  const tags = Array.isArray(row.tags) ? row.tags : [];
  let category = triviaApiCategories[row.category];
  if (
    row.category === "arts_and_literature" &&
    tags.some((tag) => ["literature", "books", "novels", "poetry"].includes(tag))
  )
    category = "Literature";
  if (row.category === "society_and_culture") {
    if (tags.includes("mythology")) category = "Mythology";
    else if (tags.includes("religion")) category = "Religion";
    else if (tags.includes("philosophy")) category = "Philosophy";
  }
  const atom = shortAtom(row.question.text, row.correctAnswer, category, row.difficulty, {
    label: `The Trivia API · Trivia Services Ltd. · ${row.id} · adapted for typed answers`,
    url: `https://the-trivia-api.com/v2/question/${row.id}`,
    license:
      "CC BY-NC 4.0 — https://creativecommons.org/licenses/by-nc/4.0/ · noncommercial use only; choices removed; text normalized; numeric count aliases",
  });
  if (atom && /^how many\b/i.test(atom.text)) {
    const words = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
      "thirteen",
      "fourteen",
      "fifteen",
      "sixteen",
      "seventeen",
      "eighteen",
      "nineteen",
      "twenty",
    ];
    const word = normalizeAnswer(atom.answer.canonical);
    const index = words.indexOf(word);
    if (index >= 0) atom.answer.aliases.push(String(index));
    else if (/^(?:\d|1\d|20)$/.test(word)) atom.answer.aliases.push(words[Number(word)]);
  }
  return atom;
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
  if (/[{}]/.test(row.answer) && row.dataset !== "protobowl") return null;
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
        "CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/ · text normalized; simple answer rules adapted" +
        (/[{}]/.test(row.answer) ? "; required-word markup preserved as answer aliases" : ""),
      authors: `QANTA / original question authors; ${row.dataset ?? "unknown collection"}; source difficulty: ${row.difficulty ?? "unrated"}`,
    },
  };
}

/** Read literal data only, never execute the source website's JavaScript. */
export function parseLearnClashFile(html) {
  const block = /const questions = \[\n([\s\S]*?)\n\];/.exec(html)?.[1];
  if (!block) throw new Error("Missing LearnClash question array");
  const string = '"(?:\\\\.|[^"\\\\])*"';
  const pattern = new RegExp(
    `^\\s*\\{id:(\\d+),category:(${string}),q:(${string}),a:(${string}),explain:(${string})\\},?\\s*$`,
  );
  return block
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("//"))
    .map((line) => {
      const match = pattern.exec(line);
      if (!match) throw new Error("Unexpected LearnClash data syntax");
      return {
        id: Number(match[1]),
        category: JSON.parse(match[2]),
        question: JSON.parse(match[3]),
        answer: JSON.parse(match[4]),
        explanation: JSON.parse(match[5]),
      };
    });
}
const learnClashCategories = {
  Science: "Science",
  Geography: "Geography",
  History: "History",
  "General Knowledge": "General",
  Sports: "Sport",
  "Food & Drink": "General",
  Mythology: "Mythology",
  "Pop Culture": "Entertainment",
};
export function learnClashAtom(row, revision, review) {
  if (!row || !Number.isSafeInteger(row.id) || !Object.hasOwn(learnClashCategories, row.category))
    return null;
  const decision = review[String(row.id)];
  if (
    decision &&
    (row.question !== decision.originalQuestion || row.answer !== decision.originalAnswer)
  )
    throw new Error(`LearnClash review no longer matches question ${row.id}`);
  if (decision?.exclude) return null;
  const atom = shortAtom(
    row.question,
    decision?.canonical ?? row.answer,
    learnClashCategories[row.category],
    "unrated",
    {
      label: `LearnClash · Pluxia GmbH · #${row.id}`,
      url: `https://github.com/Pluxia-GmbH/learnclash-open-trivia/blob/${revision}/index.html`,
      license:
        "CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ · text normalized; answer explanations separated; reviewed aliases",
    },
  );
  if (atom && decision?.aliases) atom.answer.aliases = decision.aliases;
  return atom;
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
