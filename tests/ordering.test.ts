import { describe, expect, it } from "vitest";
import { hashSort } from "@/lib/hash";
import { presentationLabels, presentationOrder, williamsRow } from "@/lib/ordering";

describe("williamsRow", () => {
  it.each([6, 8])("is a balanced Latin square for n=%i", (n) => {
    const rows = Array.from({ length: n }, (_, r) => williamsRow(n, r));
    for (const row of rows) expect([...row].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    for (let pos = 0; pos < n; pos++) expect(new Set(rows.map((r) => r[pos])).size).toBe(n);
    // Each ordered neighbour pair appears exactly once (carry-over balance).
    const pairs = new Set(rows.flatMap((r) => r.slice(1).map((c, i) => `${r[i]}>${c}`)));
    expect(pairs.size).toBe(n * (n - 1));
  });
});

describe("presentationOrder", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `rsp_${i}`);
  const params = { studySeed: "s", itemId: "item-1", responseIds: ids, queuePosition: 3, reviewerSlot: 1 };

  it("is reproducible and a permutation", () => {
    const a = presentationOrder(params);
    expect(presentationOrder({ ...params, responseIds: [...ids].reverse() })).toEqual(a);
    expect([...a].sort()).toEqual([...ids].sort());
  });

  it("gives two reviewers different orders for the same item", () => {
    const r1 = presentationOrder({ ...params, reviewerSlot: 1 });
    const r2 = presentationOrder({ ...params, reviewerSlot: 2 });
    expect(r1).not.toEqual(r2);
    // Every response lands in a different position for the second reviewer.
    expect(r1.every((id, pos) => r2[pos] !== id)).toBe(true);
  });

  it("balances base slots over positions within a reviewer", () => {
    const counts = new Map<string, Set<number>>();
    for (let q = 0; q < 8; q++) {
      const base = hashSort(ids, `s:base:item-${q}`, (x) => x);
      const order = presentationOrder({ ...params, itemId: `item-${q}`, queuePosition: q });
      order.forEach((id, pos) => {
        const slot = base.indexOf(id);
        counts.set(String(slot), (counts.get(String(slot)) ?? new Set()).add(pos));
      });
    }
    for (const positions of counts.values()) expect(positions.size).toBe(8);
  });

  it("labels responses A..H", () => {
    expect(presentationLabels(8)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });
});
