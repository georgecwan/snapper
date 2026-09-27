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
  let previous: number[] | null = null;
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      // A common adjacent-letter swap is one typo, not two substitutions.
      if (previous && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        next[j] = Math.min(next[j]!, previous[j - 2]! + 1);
    }
    previous = row;
    row = next;
  }
  return row[b.length]!;
}

const contradicts = /\b(?:not|no|nor|or|neither|except|without|versus|vs|instead)\b/;

function wordDistance(guess: string, target: string): number {
  if (guess === target) return 0;
  // Keep short names, numbers, signs, initials and symbols exact. Longer words
  // can lose, gain or swap a few letters without changing the intended answer.
  if (
    target.length < 5 ||
    guess.length < 4 ||
    !/^\p{L}+$/u.test(target) ||
    !/^\p{L}+$/u.test(guess)
  )
    return Infinity;
  const tolerance = Math.min(3, Math.floor(target.length / 5));
  const edits = distance(guess, target, tolerance);
  return edits <= tolerance ? edits : Infinity;
}

function matchingWords(supplied: string[], target: string[]): boolean {
  if (supplied.length !== target.length) return false;
  const edits = supplied.reduce((sum, word, index) => sum + wordDistance(word, target[index]!), 0);
  return edits <= Math.max(1, Math.min(3, Math.floor(target.join("").length / 5)));
}

function matches(guess: string, expected: string, fuzzy: boolean): boolean {
  const target = normalizeAnswer(expected);
  if (!target) return false;
  if (guess === target) return true;
  if (!fuzzy || contradicts.test(guess)) return false;
  return matchingWords(guess.split(" "), target.split(" "));
}

const optionalWords = new Set(["a", "an", "the", "of", "and"]);
function harmlessOmission(guess: string, expected: string): boolean {
  if (contradicts.test(guess)) return false;
  const target = normalizeAnswer(expected).split(" ");
  const supplied = guess.split(" ");
  const meaningful = target.filter((word) => !optionalWords.has(word));
  return (
    supplied.length < target.length &&
    meaningful.length >= 2 &&
    matchingWords(
      supplied.filter((word) => !optionalWords.has(word)),
      meaningful,
    )
  );
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

/** Missing meaningful words prompt once, including close spellings of the supplied words. */
function isPartial(guess: string, expected: string): boolean {
  if (contradicts.test(guess)) return false;
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
  let edits = 0;
  for (const word of supplied) {
    const next = target.findIndex(
      (candidate, index) => index >= position && Number.isFinite(wordDistance(word, candidate)),
    );
    if (next < 0) return false;
    edits += wordDistance(word, target[next]!);
    position = next + 1;
  }
  return edits <= Math.max(1, Math.min(3, Math.floor(supplied.join("").length / 5)));
}

export function judgeAnswer(text: string, answer: AnswerSpec, clarificationUsed = false): Verdict {
  const guess = normalizeAnswer(text);
  if (!guess) return "reject";
  if (answer.rejects?.some((value) => matches(guess, value, false))) return "reject";
  if (answer.orderedItems) {
    const items = text.split(/\s*(?:;|\n|→|>|,)\s*/).map(normalizeAnswer);
    if (items.length > answer.orderedItems.length || items.some((item) => !item)) return "reject";
    const complete = items.map((item, index) =>
      answer.orderedItems![index]!.some(
        (target) => matches(item, target, true) || harmlessOmission(item, target),
      ),
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
  const accepted = [answer.canonical, ...answer.aliases];
  if (accepted.some((value) => matches(guess, value, false))) return "accept";
  // Do not let the broader typo rule turn a known wrong answer into a correct one.
  if (answer.rejects?.some((value) => matches(guess, value, true))) return "reject";
  if (answer.promptAliases?.some((value) => matches(guess, value, true)))
    return clarificationUsed ? "reject" : "prompt";
  if (accepted.some((value) => matches(guess, value, true) || harmlessOmission(guess, value)))
    return "accept";
  if (!clarificationUsed && accepted.some((value) => isPartial(guess, value))) return "prompt";
  return "reject";
}
