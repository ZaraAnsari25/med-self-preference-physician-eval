import { describe, expect, it } from "vitest";
import { checkPlan, generatePlan, planProblems, PlanError, type PlanCase } from "@/lib/plan";

// Synthetic cases with an uneven specialty mix, like the Real-POCQi sample.
const SPECIALTIES = ["Cardiology", "Dermatology", "Endocrinology", "Genetics", "Nephrology", "Neurology", "Oncology"];
const WEIGHTS = [9, 6, 9, 1, 3, 5, 8];
function pocqiCases(total = 100): PlanCase[] {
  const labels = SPECIALTIES.flatMap((s, i) => Array(WEIGHTS[i]).fill(s));
  return Array.from({ length: total }, (_, i) => ({
    itemId: `item-${String(i).padStart(3, "0")}`,
    sampleIndex: i,
    specialty: labels.at((i * 7) % labels.length) as string,
  }));
}
const medspCases = (total = 100): PlanCase[] =>
  Array.from({ length: total }, (_, i) => ({ itemId: `scen-${i}`, sampleIndex: i, specialty: null }));
const reviewers = (n: number) => Array.from({ length: n }, (_, i) => `reviewer-${i + 1}`);

const base = { calibrationCount: 4, gradersPerCase: 3, seed: "test-plan" };

describe("study plan: 8 physicians, 4 calibration, 3 graders", () => {
  const cases = pocqiCases();
  const plan = generatePlan({ ...base, cases, reviewerIds: reviewers(8) });

  it("produces 8 blocks of 12 and 40 cases per physician", () => {
    expect(plan.blockSize).toBe(12);
    expect(plan.blocks.map((b) => b.length)).toEqual(Array(8).fill(12));
    expect(plan.slots.map((s) => s.queue.length)).toEqual(Array(8).fill(40));
  });

  it("passes every check", () => {
    expect(checkPlan(plan, 100).every((c) => c.ok)).toBe(true);
  });

  it("rotates consecutive blocks: P1 = B1–B3, P8 = B8, B1, B2", () => {
    expect(plan.slots.at(0)!.blocks).toEqual([1, 2, 3]);
    expect(plan.slots.at(7)!.blocks).toEqual([8, 1, 2]);
    // Each physician overlaps with exactly 4 of the other 7.
    for (const s of plan.slots) {
      const others = plan.slots.filter((o) => o !== s && o.blocks.some((b) => s.blocks.includes(b)));
      expect(others).toHaveLength(4);
    }
  });

  it("picks calibration cases from 4 different specialties", () => {
    const spec = new Map(cases.map((c) => [c.itemId, c.specialty]));
    expect(new Set(plan.calibration.map((id) => spec.get(id))).size).toBe(4);
  });

  it("spreads each specialty evenly across blocks (counts differ by at most 1 among blocks it reaches)", () => {
    const spec = new Map(cases.map((c) => [c.itemId, c.specialty]));
    for (const s of SPECIALTIES) {
      const counts = plan.blocks.map((b) => b.filter((id) => spec.get(id) === s).length);
      const total = counts.reduce((a, b) => a + b, 0);
      if (total >= 8) expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      else expect(Math.max(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it("shuffles each physician's queue independently", () => {
    expect(plan.slots.at(0)!.queue).not.toEqual([...plan.slots.at(0)!.queue].sort());
    const firstCases = new Set(plan.slots.map((s) => s.queue.at(0)));
    expect(firstCases.size).toBeGreaterThan(1);
  });

  it("is reproducible and does not depend on the order physicians are listed", () => {
    const again = generatePlan({ ...base, cases: [...cases].reverse(), reviewerIds: [...reviewers(8)].reverse() });
    expect(again).toEqual(plan);
    const other = generatePlan({ ...base, seed: "other-seed", cases, reviewerIds: reviewers(8) });
    expect(other.slots.map((s) => s.reviewerId)).not.toEqual(plan.slots.map((s) => s.reviewerId));
  });
});

describe("study plan without specialties (MedSP1000)", () => {
  it("takes the first cases as calibration and deals the rest in sample order", () => {
    const plan = generatePlan({ ...base, cases: medspCases(), reviewerIds: reviewers(8) });
    expect(plan.calibration).toEqual(["scen-0", "scen-1", "scen-2", "scen-3"]);
    expect(plan.blocks.at(0)!.slice(0, 2)).toEqual(["scen-4", "scen-12"]);
    expect(checkPlan(plan, 100).every((c) => c.ok)).toBe(true);
  });
});

describe("invalid designs", () => {
  it("explains a split that does not divide evenly", () => {
    expect(planProblems({ cases: medspCases(), physicianCount: 8, calibrationCount: 5, gradersPerCase: 3 }).join()).toMatch(
      /95, which does not split evenly into 8 blocks/,
    );
    expect(() => generatePlan({ ...base, calibrationCount: 5, cases: medspCases(), reviewerIds: reviewers(8) })).toThrow(PlanError);
  });

  it("refuses more distinct-specialty calibration cases than there are specialties", () => {
    expect(() => generatePlan({ ...base, calibrationCount: 10, cases: pocqiCases(), reviewerIds: reviewers(10) })).toThrow(
      /Only 7 specialties/,
    );
  });

  it("rejects more graders than physicians and duplicate physicians", () => {
    expect(() => generatePlan({ ...base, gradersPerCase: 9, cases: medspCases(), reviewerIds: reviewers(8) })).toThrow(/needs 9 graders, but only 8 physicians/);
    expect(() => generatePlan({ ...base, cases: medspCases(), reviewerIds: ["a", "a", "b", "c"] })).toThrow(/listed twice/);
  });

  it("supports other designs, e.g. 10 physicians, 10 calibration, 3 graders", () => {
    const plan = generatePlan({ ...base, calibrationCount: 10, cases: medspCases(), reviewerIds: reviewers(10) });
    expect(plan.blockSize).toBe(9);
    expect(plan.slots.every((s) => s.queue.length === 37)).toBe(true);
    expect(checkPlan(plan, 100).every((c) => c.ok)).toBe(true);
  });
});
