import type { AnswerSpec } from "./protocol.ts";

export type Verdict = "accept" | "reject" | "prompt";

/** Keep symbols and numbers: removing them makes answers such as −5 and 5 equal. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[’']/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/&/g, " and ")
    .replace(/[“”"!?;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|an|a)\s+(?=\p{L})/u, "");
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length]!;
}

function matches(guess: string, expected: string, fuzzy: boolean): boolean {
  const target = normalizeAnswer(expected);
  if (!target) return false;
  if (guess === target) return true;
  // Exact complete answers first; never match an answer occurring inside a longer guess.
  // Conservative spelling tolerance excludes numbers, symbols, alternatives and negation.
  if (!fuzzy || target.length < 8 || !/^[\p{L} ]+$/u.test(target) || !/^[\p{L} ]+$/u.test(guess))
    return false;
  if (
    /\b(?:not|or|neither|except)\b/.test(guess) ||
    guess.split(" ").length !== target.split(" ").length
  )
    return false;
  const tolerance = target.length >= 20 ? 2 : 1;
  return distance(guess, target, tolerance) <= tolerance;
}

const connectiveWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

/** Missing complete words may need elaboration; fragments and extra claims do not. */
function isPartial(guess: string, expected: string): boolean {
  if (/\b(?:not|no|nor|or|neither|except|without|versus|vs|instead)\b/.test(guess)) return false;
  const words = (value: string) => value.replace(/,/g, " ").trim().split(/\s+/);
  const supplied = words(guess);
  const target = words(normalizeAnswer(expected));
  if (
    supplied.length >= target.length ||
    !supplied.some(
      (word) =>
        (!connectiveWords.has(word) && /\p{L}{3}/u.test(word)) ||
        /^\p{N}+(?:\.\p{N}+)?$/u.test(word),
    ) ||
    // Preserve decimal numbers, initials and hyphenated words as whole tokens.
    // Never turn signed numbers, mathematical symbols or word fragments into
    // a match by dropping their punctuation.
    [...supplied, ...target].some((word) => !/^[\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*\.?$/u.test(word))
  )
    return false;
  // A date's complete year/day may be useful but must not erase the sign of
  // a number whose sign was written out instead of using a symbol.
  if (
    target.some(
      (word, index) =>
        /^(?:minus|negative|plus|positive)$/.test(word) &&
        /^\p{N}+(?:\.\p{N}+)?$/u.test(target[index + 1] ?? "") &&
        supplied.includes(target[index + 1]!) &&
        !supplied.includes(word),
    )
  )
    return false;
  let position = 0;
  for (const word of supplied) {
    const next = target.indexOf(word, position);
    if (next < 0) return false;
    position = next + 1;
  }
  return true;
}

export function judgeAnswer(text: string, answer: AnswerSpec, clarificationUsed = false): Verdict {
  const guess = normalizeAnswer(text);
  if (!guess) return "reject";
  if (answer.rejects?.some((value) => matches(guess, value, false))) return "reject";
  if (answer.orderedItems) {
    const items = text.split(/\s*(?:;|\n|→|>|,)\s*/).map(normalizeAnswer);
    if (items.length > answer.orderedItems.length || items.some((item) => !item)) return "reject";
    const complete = items.map((item, index) =>
      answer.orderedItems![index]!.some((target) => matches(item, target, true)),
    );
    if (items.length === answer.orderedItems.length && complete.every(Boolean)) return "accept";
    return !clarificationUsed &&
      items.every(
        (item, index) =>
          complete[index] || answer.orderedItems![index]!.some((target) => isPartial(item, target)),
      )
      ? "prompt"
      : "reject";
  }
  if ([answer.canonical, ...answer.aliases].some((value) => matches(guess, value, true)))
    return "accept";
  if (
    !clarificationUsed &&
    (answer.promptAliases?.some((value) => matches(guess, value, false)) ||
      [answer.canonical, ...answer.aliases].some((value) => isPartial(guess, value)))
  )
    return "prompt";
  return "reject";
}
