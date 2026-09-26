import type { Tossup } from "./questions";

export function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const gap = Math.abs(a.length - b.length);
  if (gap > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length] ?? 3;
}

function allowedDistance(target: string): number {
  if (target.length >= 12) return 2;
  if (target.length >= 5) return 1;
  return 0;
}

export function isCorrect(guess: string, q: Tossup): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  const targets = [q.answer, ...q.accepts].map(normalizeAnswer).filter(Boolean);
  const unique = [...new Set(targets)];
  return unique.some((t) => {
    if (g === t) return true;
    if (` ${g} `.includes(` ${t} `) && g.length <= t.length + 28) return true;
    const dist = allowedDistance(t);
    return dist > 0 && levenshtein(g, t) <= dist;
  });
}
