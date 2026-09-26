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

export function judgeAnswer(text: string, answer: AnswerSpec, clarificationUsed = false): Verdict {
  const guess = normalizeAnswer(text);
  if (!guess) return "reject";
  if (answer.rejects?.some((value) => matches(guess, value, false))) return "reject";
  if (answer.orderedItems) {
    const items = text.split(/\s*(?:;|\n|→|>|,)\s*/).map(normalizeAnswer);
    return items.length === answer.orderedItems.length &&
      items.every(
        (item, index) =>
          !!item && answer.orderedItems![index]!.some((target) => matches(item, target, true)),
      )
      ? "accept"
      : "reject";
  }
  if ([answer.canonical, ...answer.aliases].some((value) => matches(guess, value, true)))
    return "accept";
  if (!clarificationUsed && answer.promptAliases?.some((value) => matches(guess, value, false)))
    return "prompt";
  return "reject";
}
