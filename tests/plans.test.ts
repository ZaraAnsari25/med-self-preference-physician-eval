import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { assignments } from "@/db/schema";
import { assignItems, validateStudyData } from "@/server/admin";
import { listQueue, loadEvaluation, saveEvaluation } from "@/server/evaluations";
import { buildExport } from "@/server/exports";
import { importBundle } from "@/server/importer";
import { applyPlan, eligibleReviewers, planStatus, previewPlan, transferSlot } from "@/server/plans";
import { completeState, fixtureBundle, freshDb, makeReviewer, MODELS } from "./helpers";

const SPECIALTIES = ["Cardiology", "Dermatology", "Endocrinology", "Nephrology", "Neurology", "Oncology"];
let db: DB;
let close: () => Promise<void>;
let physicians: { userId: string; reviewerCode: string }[];
const design = { study: "real_pocqi" as const, calibrationCount: 4, gradersPerCase: 3, seed: "pe-plan-test" };

// One database for the whole file: applying a plan is the expensive step, and
// the tests below build on each other in order (apply → grade → transfer → export).
beforeAll(async () => {
  ({ db, close } = await freshDb());
  await importBundle(db, fixtureBundle(100, "real_pocqi", { specialties: SPECIALTIES }));
  physicians = [];
  for (let i = 1; i <= 8; i++) physicians.push(await makeReviewer(db, `doc${i}`));
});
afterAll(async () => close());

describe("applying a study plan", () => {
  it("previews the 8-block design with all checks passing", async () => {
    const preview = await previewPlan(db, { ...design, reviewerIds: physicians.map((p) => p.userId) });
    expect(preview.problems).toEqual([]);
    expect(preview.checks.every((c) => c.ok)).toBe(true);
    expect(new Set(preview.calibrationSpecialties).size).toBe(4);
    expect(preview.blockSpecialties).toHaveLength(8);
  });

  it("explains a design that does not divide evenly", async () => {
    const preview = await previewPlan(db, { ...design, calibrationCount: 5, reviewerIds: physicians.map((p) => p.userId) });
    expect(preview.plan).toBeNull();
    expect(preview.problems.join()).toMatch(/does not split evenly/);
  });

  it("creates 40 cases per physician, 320 in total, and passes validation", async () => {
    const result = await applyPlan(db, { ...design, reviewerIds: physicians.map((p) => p.userId) });
    expect(result.assignments).toBe(320);
    for (const p of physicians) expect(await listQueue(db, p.userId, "real_pocqi")).toHaveLength(40);
    expect((await validateStudyData(db)).ok).toBe(true);
    const status = (await planStatus(db, "real_pocqi"))!;
    expect(status.blocks.map((b) => b.total)).toEqual(Array(8).fill(36));
    expect(status.calibration).toMatchObject({ cases: 4, total: 32 });
    expect((await eligibleReviewers(db, "real_pocqi")).map((r) => r.userId)).toEqual([]);
    // The same physicians are offered for MedSP1000 but flagged as already in Real-POCQi.
    const medsp = await eligibleReviewers(db, "medsp1000");
    expect(medsp.filter((r) => r.otherStudies.includes("real_pocqi"))).toHaveLength(8);
  });

  it("refuses to regenerate an applied plan", async () => {
    await expect(applyPlan(db, { ...design, reviewerIds: physicians.map((p) => p.userId) })).rejects.toThrow(/already has an applied plan/);
  });

  it("keeps grading blinded for plan assignments", async () => {
    const payload = await loadEvaluation(db, physicians[0].userId, "real_pocqi", 1);
    const json = JSON.stringify(payload);
    for (const [model] of MODELS) expect(json).not.toContain(model);
    expect(json).not.toContain("calibration");
  });
});

describe("handing a position to a replacement physician", () => {
  it("moves unfinished cases, keeps finished ones, and keeps 3 graders per case", async () => {
    const status = (await planStatus(db, "real_pocqi"))!;
    const slot = status.slots.at(0)!;
    const original = physicians.find((p) => p.userId === slot.reviewerId)!;
    // Finish one case and start another.
    await saveEvaluation(db, original.userId, "real_pocqi", 1, { state: completeState(), baseRevision: 0 });
    const partial = completeState();
    partial.rankingConfirmed = false;
    await saveEvaluation(db, original.userId, "real_pocqi", 2, { state: partial, baseRevision: 0 });

    const replacement = await makeReviewer(db, "doc9");
    const { moved } = await transferSlot(db, "real_pocqi", slot.slot, replacement.userId);
    expect(moved).toBe(39);
    expect(await listQueue(db, original.userId, "real_pocqi")).toHaveLength(1);
    const newQueue = await listQueue(db, replacement.userId, "real_pocqi");
    expect(newQueue).toHaveLength(39);
    expect(newQueue.every((q) => q.status === "not_started")).toBe(true); // nobody inherits half-finished work

    const [old] = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.reviewerId, original.userId), eq(assignments.status, "in_progress")));
    expect(old.transferredAt).not.toBeNull();

    expect((await validateStudyData(db)).ok).toBe(true);
    const after = (await planStatus(db, "real_pocqi"))!;
    expect(after.slots.at(0)!.reviewerCode).toBe(replacement.reviewerCode);
    expect(after.slots.at(0)!.complete).toBe(1);
    expect(after.transfers).toHaveLength(1);
  });
});

describe("plan exports", () => {
  it("labels every physician row with its position, block and calibration flag", async () => {
    const rows = await buildExport(db, "rankings");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.physician_slot).toMatch(/^P[1-8]$/);
      expect(r.block === "calibration" || /^B[1-8]$/.test(String(r.block))).toBe(true);
      expect(r.is_calibration).toBe(r.block === "calibration");
    }
    expect(rows.some((r) => r.transferred === true)).toBe(true);
  });

  it("exports the plan grid: 8 graders per calibration case, 3 per block case", async () => {
    const rows = await buildExport(db, "plan");
    expect(rows).toHaveLength(100);
    for (const r of rows) {
      const n = String(r.graders).split(";").length;
      expect(n).toBe(r.is_calibration ? 8 : 3);
    }
  });

  it("keeps manual assignment available alongside a plan", async () => {
    const extra = await makeReviewer(db, "doc10");
    expect((await assignItems(db, extra.userId, { study: "real_pocqi", count: 2 })).assigned).toBe(2);
    const manual = (await buildExport(db, "assignments")).filter((r) => r.reviewer_code === extra.reviewerCode);
    expect(manual.every((r) => r.plan_id === null && r.block === null)).toBe(true);
  });
});
