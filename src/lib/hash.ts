import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Deterministic, language-independent shuffle: sort items by
 * sha256(`${seed}:${key}`). Any implementation (Python, R, SQL) that computes
 * the same hashes reproduces the same order, which is why we use it instead of
 * a seeded PRNG.
 */
export function hashSort<T>(items: readonly T[], seed: string, key: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, h: sha256Hex(`${seed}:${key(item)}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map(({ item }) => item);
}
