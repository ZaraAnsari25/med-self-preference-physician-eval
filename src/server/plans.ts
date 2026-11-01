// Study plans: preview, apply, progress and slot transfer. Admin-only.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { assignments, items, responses, studyPlans, users, type SlotTransfer } from "@/db/schema";
import { presentationOrder } from "@/lib/ordering";
import { checkPlan, generatePlan, planProblems, type PlanCheck, type StudyPlan } from "@/lib/plan";
import { STUDIES, type StudyId } from "@/lib/studies";
import { getStudySeed } from "./settings";

export interface PlanRequest {
  study: StudyId;
  reviewerIds: string[];
  calibrationCount: number;
  gradersPerCase: number;
  seed: string;
}

export interface PlanPreview {
  problems: string[];
  plan: StudyPlan | null;
  checks: PlanCheck[];
  /** For the grid: reviewer code + username per reviewer id. */
  reviewers: Record<string, { reviewerCode: string; username: string }>;
  /** Specialty count per block (Real-POCQi), for the specialty-mix view. */
  blockSpecialties: Record<string, number>[];
  calibrationSpecialties: (string | null)[];
}

export class PlanApplyError extends Error {}

export const defaultPlanSeed = (study: StudyId) => `pe-plan-${study}-v1`;

async function planCases(db: DB, study: StudyId) {
  return db
    .select({ itemId: items.itemId, sampleIndex: items.sampleIndex, specialty: items.specialty })
    .from(items)
    .where(eq(items.study, study))
    .orderBy(asc(items.sampleIndex));
}

/** Active reviewers with no current assignments in the study (eligible for a new plan or a transfer). */
export async function eligibleReviewers(db: DB, study: StudyId) {
  const busy = db
    .select({ id: assignments.reviewerId })
    .from(assignments)
    .where(and(eq(assignments.study, study), isNull(assignments.transferredAt)));
  const people = await db
    .select({ userId: users.userId, reviewerCode: users.reviewerCode, username: users.username, specialty: users.specialty })
    .from(users)
    .where(and(eq(users.role, "reviewer"), eq(users.active, true), sql`${users.userId} not in (${busy})`))
    .orderBy(asc(users.reviewerCode));
  // Flag people already grading another study, so a separate-groups design is easy to keep.
  const elsewhere = await db
    .selectDistinct({ reviewerId: assignments.reviewerId, study: assignments.study })
    .from(assignments)
    .where(and(ne(assignments.study, study), isNull(assignments.transferredAt)));
  return people.map((p) => ({ ...p, otherStudies: elsewhere.filter((e) => e.reviewerId === p.userId).map((e) => e.study) }));
}

export async function previewPlan(db: DB, req: PlanRequest): Promise<PlanPreview> {
  const cases = await planCases(db, req.study);
  const people = req.reviewerIds.length
    ? await db.select().from(users).where(inArray(users.userId, req.reviewerIds))
    : [];
  const reviewers = Object.fromEntries(people.map((u) => [u.userId, { reviewerCode: u.reviewerCode, username: u.username }]));
  const empty = { plan: null, checks: [], reviewers, blockSpecialties: [], calibrationSpecialties: [] };
  if (cases.length === 0) return { ...empty, problems: [`No ${STUDIES[req.study].name} cases have been imported.`] };
  if (people.length !== req.reviewerIds.length || people.some((u) => u.role !== "reviewer")) {
    return { ...empty, problems: ["Every selected account must be a reviewer account."] };
  }
  const problems = planProblems({ cases, physicianCount: req.reviewerIds.length, ...req });
  if (problems.length) return { ...empty, problems };
  const plan = generatePlan({ cases, ...req });
  const specialtyOf = new Map(cases.map((c) => [c.itemId, c.specialty]));
  return {
    problems: [],
    plan,
    checks: checkPlan(plan, cases.length),
    reviewers,
    blockSpecialties: plan.blocks.map((b) => {
      const counts: Record<string, number> = {};
      for (const id of b) {
        const s = specialtyOf.get(id);
        if (s) counts[s] = (counts[s] ?? 0) + 1;
      }
      return counts;
    }),
    calibrationSpecialties: plan.calibration.map((id) => specialtyOf.get(id) ?? null),
  };
}

/** Generate the plan and create every assignment at once. Refuses if the study already has a plan. */
export async function applyPlan(db: DB, req: PlanRequest): Promise<{ planId: string; assignments: number }> {
  const [existing] = await db.select().from(studyPlans).where(eq(studyPlans.study, req.study));
  if (existing) throw new PlanApplyError(`${STUDIES[req.study].name} already has an applied plan; it cannot be regenerated.`);
  const eligible = new Set((await eligibleReviewers(db, req.study)).map((r) => r.userId));
  const blocked = req.reviewerIds.filter((id) => !eligible.has(id));
  if (blocked.length) {
    throw new PlanApplyError("Some selected physicians are inactive or already have cases in this study.");
  }
  const preview = await previewPlan(db, req);
  if (!preview.plan) throw new PlanApplyError(preview.problems.join(" "));
  if (!preview.checks.every((c) => c.ok)) throw new PlanApplyError("The plan failed its checks.");
  const plan = preview.plan;
  const studySeed = await getStudySeed(db, req.study);
  if (!studySeed) throw new PlanApplyError("No study bundle has been imported.");

  const reviewerSlot = new Map(
    (await db.select({ id: users.userId, slot: users.reviewerSlot }).from(users).where(inArray(users.userId, req.reviewerIds))).map(
      (r) => [r.id, r.slot],
    ),
  );
  const responseIds = new Map<string, string[]>();
  for (const r of await db
    .select({ itemId: responses.itemId, responseId: responses.responseId })
    .from(responses)
    .innerJoin(items, eq(items.itemId, responses.itemId))
    .where(eq(items.study, req.study))) {
    responseIds.set(r.itemId, [...(responseIds.get(r.itemId) ?? []), r.responseId]);
  }
  const blockOf = new Map(plan.blocks.flatMap((b, i) => b.map((id) => [id, i + 1] as const)));
  const calibration = new Set(plan.calibration);

  const planId = randomUUID();
  const rows = plan.slots.flatMap((s) =>
    s.queue.map((itemId, position) => ({
      assignmentId: randomUUID(),
      reviewerId: s.reviewerId,
      itemId,
      study: req.study,
      queuePosition: position,
      presentationOrder: presentationOrder({
        studySeed,
        itemId,
        responseIds: responseIds.get(itemId) ?? [],
        queuePosition: position,
        reviewerSlot: reviewerSlot.get(s.reviewerId)!,
      }),
      planId,
      planSlot: s.slot,
      planBlock: calibration.has(itemId) ? null : blockOf.get(itemId)!,
      isCalibration: calibration.has(itemId),
    })),
  );
  await db.transaction(async (tx) => {
    await tx.insert(studyPlans).values({
      planId,
      study: req.study,
      seed: plan.seed,
      physicianCount: plan.physicianCount,
      calibrationCount: plan.calibrationCount,
      gradersPerCase: plan.gradersPerCase,
      blockSize: plan.blockSize,
      design: plan,
    });
    for (let i = 0; i < rows.length; i += 200) await tx.insert(assignments).values(rows.slice(i, i + 200));
  });
  return { planId, assignments: rows.length };
}

export interface PlanStatus {
  planId: string;
  study: StudyId;
  seed: string;
  physicianCount: number;
  calibrationCount: number;
  gradersPerCase: number;
  blockSize: number;
  appliedAt: string;
  slots: {
    slot: number;
    blocks: number[];
    reviewerId: string;
    reviewerCode: string;
    username: string;
    active: boolean;
    complete: number;
    total: number;
    submitted: boolean;
  }[];
  /** Per block: case gradings complete out of blockSize × gradersPerCase, and cases fully graded. */
  blocks: { block: number; complete: number; total: number; casesDone: number; cases: number }[];
  calibration: { complete: number; total: number; casesDone: number; cases: number };
  transfers: (SlotTransfer & { fromCode: string; toCode: string })[];
}

export async function planStatus(db: DB, study: StudyId): Promise<PlanStatus | null> {
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.study, study));
  if (!plan) return null;
  const rows = await db
    .select({
      reviewerId: assignments.reviewerId,
      itemId: assignments.itemId,
      slot: assignments.planSlot,
      block: assignments.planBlock,
      isCalibration: assignments.isCalibration,
      status: assignments.status,
      submittedAt: assignments.submittedAt,
    })
    .from(assignments)
    .where(and(eq(assignments.planId, plan.planId), isNull(assignments.transferredAt)));
  const people = new Map((await db.select().from(users)).map((u) => [u.userId, u]));
  const design = plan.design as StudyPlan;

  const doneByItem = new Map<string, number>();
  for (const r of rows) if (r.status === "complete") doneByItem.set(r.itemId, (doneByItem.get(r.itemId) ?? 0) + 1);
  const tally = (ids: string[], need: number) => ({
    complete: ids.reduce((a, id) => a + (doneByItem.get(id) ?? 0), 0),
    total: ids.length * need,
    casesDone: ids.filter((id) => (doneByItem.get(id) ?? 0) >= need).length,
    cases: ids.length,
  });

  const slots = design.slots.map((s) => {
    const mine = rows.filter((r) => r.slot === s.slot);
    const current = currentHolder(plan.transfers, s.slot, s.reviewerId);
    const u = people.get(current)!;
    return {
      slot: s.slot,
      blocks: s.blocks,
      reviewerId: current,
      reviewerCode: u.reviewerCode,
      username: u.username,
      active: u.active,
      complete: mine.filter((r) => r.status === "complete").length,
      total: mine.length,
      submitted: mine.length > 0 && mine.filter((r) => r.reviewerId === current).every((r) => r.submittedAt !== null),
    };
  });

  return {
    planId: plan.planId,
    study,
    seed: plan.seed,
    physicianCount: plan.physicianCount,
    calibrationCount: plan.calibrationCount,
    gradersPerCase: plan.gradersPerCase,
    blockSize: plan.blockSize,
    appliedAt: plan.appliedAt.toISOString(),
    slots,
    blocks: design.blocks.map((ids, i) => ({ block: i + 1, ...tally(ids, plan.gradersPerCase) })),
    calibration: tally(design.calibration, plan.physicianCount),
    transfers: plan.transfers.map((t) => ({
      ...t,
      fromCode: people.get(t.fromReviewerId)?.reviewerCode ?? "?",
      toCode: people.get(t.toReviewerId)?.reviewerCode ?? "?",
    })),
  };
}

function currentHolder(transfers: SlotTransfer[], slot: number, original: string) {
  return transfers.filter((t) => t.slot === slot).at(-1)?.toReviewerId ?? original;
}

/**
 * Not currently exposed in the admin dashboard or API (switched off at the study
 * team's request); kept, with its tests, so it can be turned back on if a
 * physician drops out.
 *
 * Hand a plan position to a replacement physician. Finished cases stay credited
 * to the original physician; unstarted cases move over; a case the original
 * physician had started is closed for them (kept, marked transferred) and a fresh
 * copy is created for the replacement, so nobody inherits half-finished work.
 */
export async function transferSlot(db: DB, study: StudyId, slot: number, toReviewerId: string) {
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.study, study));
  if (!plan) throw new PlanApplyError(`${STUDIES[study].name} has no plan.`);
  const design = plan.design as StudyPlan;
  const original = design.slots.find((s) => s.slot === slot);
  if (!original) throw new PlanApplyError(`Position P${slot} does not exist.`);
  const from = currentHolder(plan.transfers, slot, original.reviewerId);
  if (!(await eligibleReviewers(db, study)).some((r) => r.userId === toReviewerId)) {
    throw new PlanApplyError("The replacement must be an active reviewer with no cases in this study.");
  }

  const open = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.planId, plan.planId),
        eq(assignments.planSlot, slot),
        eq(assignments.reviewerId, from),
        isNull(assignments.transferredAt),
        isNull(assignments.submittedAt),
        ne(assignments.status, "complete"),
      ),
    );
  if (!open.length) throw new PlanApplyError(`P${slot} has no unfinished cases to hand over.`);
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const a of open) {
      if (a.status === "not_started") {
        await tx.update(assignments).set({ reviewerId: toReviewerId }).where(eq(assignments.assignmentId, a.assignmentId));
      } else {
        await tx.update(assignments).set({ transferredAt: now }).where(eq(assignments.assignmentId, a.assignmentId));
        await tx.insert(assignments).values({
          assignmentId: randomUUID(),
          reviewerId: toReviewerId,
          itemId: a.itemId,
          study: a.study,
          queuePosition: a.queuePosition,
          presentationOrder: a.presentationOrder,
          planId: a.planId,
          planSlot: a.planSlot,
          planBlock: a.planBlock,
          isCalibration: a.isCalibration,
        });
      }
    }
    const record: SlotTransfer = { slot, fromReviewerId: from, toReviewerId, at: now.toISOString(), moved: open.length };
    await tx
      .update(studyPlans)
      .set({ transfers: sql`${studyPlans.transfers} || ${JSON.stringify([record])}::jsonb` })
      .where(eq(studyPlans.planId, plan.planId));
  });
  return { moved: open.length };
}
