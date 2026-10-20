import { hashSort } from "./hash";

/**
 * Row `row` of a Williams Latin square for n conditions (n even): every
 * condition appears once in every position across n consecutive rows, and
 * each ordered pair of neighbours appears exactly once. For odd n we fall back
 * to a cyclic Latin square (position-balanced only).
 */
export function williamsRow(n: number, row: number): number[] {
  if (n < 1) throw new Error("n must be positive");
  const r = ((row % n) + n) % n;
  if (n % 2 !== 0) return Array.from({ length: n }, (_, j) => (j + r) % n);
  const first: number[] = [0];
  for (let k = 1; first.length < n; k++) {
    first.push(k);
    if (first.length < n) first.push(n - k);
  }
  return first.map((c) => (c + r) % n);
}

export function presentationLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

/**
 * Presentation order for one reviewer on one item.
 *
 * 1. The item's responses are put in a per-item base order:
 *    hashSort(responseIds, `${studySeed}:base:${itemId}`).
 * 2. The reviewer's k-th queued item (0-based queuePosition) uses Williams row
 *    (queuePosition + reviewerSlot) mod n applied to that base order.
 *
 * Within a reviewer, each base slot occupies each display position once per n
 * consecutive items; two reviewers with different slots see the same item in
 * different orders. The result is stored on the assignment, so it never has to
 * be recomputed to analyse the data.
 */
export function presentationOrder(params: {
  studySeed: string;
  itemId: string;
  responseIds: readonly string[];
  queuePosition: number;
  reviewerSlot: number;
}): string[] {
  const { studySeed, itemId, responseIds, queuePosition, reviewerSlot } = params;
  const base = hashSort(responseIds, `${studySeed}:base:${itemId}`, (id) => id);
  const row = williamsRow(base.length, queuePosition + reviewerSlot);
  return row.map((i) => base[i]);
}
