import type { Format, RoomConfig } from "./protocol.ts";

export function formatWeight(config: RoomConfig, format: Format): number {
  return config.formatWeights?.[format] ?? (format === "assigned" ? 0.25 : 1);
}

/** Single-level difficulty filters take precedence over the saved mixed-level weights. */
export function contentWeight(config: RoomConfig, category: string, difficulty: string): number {
  if (
    !config.categories.includes(category as RoomConfig["categories"][number]) ||
    (config.difficulty !== "any" && config.difficulty !== difficulty)
  )
    return 0;
  const categoryWeight =
    config.categoryWeights?.[category as keyof RoomConfig["categoryWeights"]] ?? 1;
  const difficultyWeight =
    config.difficulty === "any"
      ? (config.difficultyWeights?.[difficulty as keyof RoomConfig["difficultyWeights"]] ?? 1)
      : 1;
  return categoryWeight * difficultyWeight;
}

/** Continuous tickets support fractional weights without rounding small pools to zero. */
export function weightedPick<T>(
  items: readonly T[],
  weight: (item: T) => number,
  random: () => number,
): T | undefined {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  if (total <= 0) return undefined;
  let ticket = Math.max(0, Math.min(1 - Number.EPSILON, random())) * total;
  for (const item of items) {
    ticket -= weight(item);
    if (ticket < 0) return item;
  }
  return [...items].reverse().find((item) => weight(item) > 0);
}

export function weightedSample<T>(
  items: readonly T[],
  count: number,
  weight: (item: T) => number,
  random: () => number,
): T[] {
  const pool = items.filter((item) => weight(item) > 0);
  const result: T[] = [];
  while (pool.length && result.length < count) {
    const chosen = weightedPick(pool, weight, random)!;
    result.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }
  return result;
}
