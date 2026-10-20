// Administrator operations. Callers must have verified role === "admin".
import { randomUUID } from "node:crypto";
import { and, asc, eq, max, notInArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { assignments, items, llmJudgments, responseProvenance, responses, users } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { presentationOrder } from "@/lib/ordering";
import { getStudySeed } from "./settings";

export interface ReviewerProgress {
  userId: string;
  reviewerCode: string;
  username: string;
  displayName: string | null;
  role: "reviewer" | "admin";
  active: boolean;
  assigned: number;
  complete: number;
  inProgress: number;
  notStarted: number;
  submittedAt: Date | null;
  lastSavedAt: Date | null;
}

export async function reviewerProgress(db: DB): Promise<ReviewerProgress[]> {
  const rows = await db
    .select({
      userId: users.userId,
      reviewerCode: users.reviewerCode,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
      submittedAt: users.submittedAt,
      assigned: sql<number>`count(${assignments.assignmentId})::int`,
      complete: sql<number>`count(*) filter (where ${assignments.status} = 'complete')::int`,
      inProgress: sql<number>`count(*) filter (where ${assignments.status} = 'in_progress')::int`,
      notStarted: sql<number>`count(*) filter (where ${assignments.status} = 'not_started')::int`,
      lastSavedAt: max(assignments.lastSavedAt),
    })
    .from(users)
    .leftJoin(assignments, eq(assignments.reviewerId, users.userId))
    .groupBy(users.userId)
    .orderBy(asc(users.reviewerCode));
  return rows;
}

export async function itemCount(db: DB): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(items);
  return n;
}

/**
 * Append items (by frozen sample order) to a reviewer's queue. `count` items
 * starting at sample index `start` are assigned; items the reviewer already
 * has are skipped. Presentation order is computed once and stored.
 */
export async function assignItems(db: DB, reviewerId: string, opts: { start?: number; count: number }) {
  const seed = await getStudySeed(db);
  if (!seed) throw new Error("No study bundle has been imported");
  const [reviewer] = await db.select().from(users).where(eq(users.userId, reviewerId));
  if (!reviewer) throw new Error("Reviewer not found");
  if (reviewer.submittedAt) throw new Error("Reviewer has already submitted; reopen before adding questions");

  return db.transaction(async (tx) => {
    const already = await tx.select({ itemId: assignments.itemId }).from(assignments).where(eq(assignments.reviewerId, reviewerId));
    const start = opts.start ?? 0;
    const candidates = await tx
      .select({ itemId: items.itemId })
      .from(items)
      .where(
        and(
          sql`${items.sampleIndex} >= ${start} and ${items.sampleIndex} < ${start + opts.count}`,
          already.length ? notInArray(items.itemId, already.map((a) => a.itemId)) : undefined,
        ),
      )
      .orderBy(asc(items.sampleIndex));
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${assignments.queuePosition}) + 1, 0)::int` })
      .from(assignments)
      .where(eq(assignments.reviewerId, reviewerId));
    let position = next;
    for (const c of candidates) {
      const respIds = (await tx.select({ id: responses.responseId }).from(responses).where(eq(responses.itemId, c.itemId))).map(
        (r) => r.id,
      );
      await tx.insert(assignments).values({
        assignmentId: randomUUID(),
        reviewerId,
        itemId: c.itemId,
        queuePosition: position,
        presentationOrder: presentationOrder({
          studySeed: seed,
          itemId: c.itemId,
          responseIds: respIds,
          queuePosition: position,
          reviewerSlot: reviewer.reviewerSlot,
        }),
      });
      position++;
    }
    return { assigned: candidates.length };
  });
}

export async function setReviewerActive(db: DB, userId: string, active: boolean) {
  await db.update(users).set({ active }).where(eq(users.userId, userId));
}

export interface ValidationReport {
  ok: boolean;
  items: number;
  responses: number;
  judgmentRows: number;
  assignments: number;
  problems: string[];
}

/** Integrity checks over imported content, protected mappings and assignments. */
export async function validateStudyData(db: DB): Promise<ValidationReport> {
  const problems: string[] = [];
  const allItems = await db.select({ itemId: items.itemId }).from(items);
  const allResponses = await db.select().from(responses);
  const prov = new Map((await db.select().from(responseProvenance)).map((p) => [p.responseId, p]));
  const judg = await db
    .select({
      itemId: llmJudgments.itemId,
      responseId: llmJudgments.responseId,
      generatorModel: llmJudgments.generatorModel,
      judgeModel: llmJudgments.judgeModel,
      originalRank: llmJudgments.originalRank,
    })
    .from(llmJudgments);
  const asg = await db.select().from(assignments);

  const respByItem = new Map<string, typeof allResponses>();
  for (const r of allResponses) respByItem.set(r.itemId, [...(respByItem.get(r.itemId) ?? []), r]);
  for (const { itemId } of allItems) {
    const rs = respByItem.get(itemId) ?? [];
    if (rs.length !== 8) problems.push(`${itemId}: ${rs.length} responses (expected 8)`);
    const models = new Set<string>();
    for (const r of rs) {
      const p = prov.get(r.responseId);
      if (!p) problems.push(`${r.responseId}: no provenance`);
      else {
        models.add(p.generatorModel);
        if (sha256Hex(r.responseText) !== p.responseTextSha256) problems.push(`${r.responseId}: text hash mismatch`);
      }
    }
    if (models.size !== rs.length) problems.push(`${itemId}: generator models not unique`);
    const js = judg.filter((j) => j.itemId === itemId);
    if (js.length !== rs.length * rs.length) {
      problems.push(`${itemId}: ${js.length} judgment rows (expected ${rs.length * rs.length})`);
    }
    for (const j of js) {
      if (prov.get(j.responseId)?.generatorModel !== j.generatorModel) problems.push(`${itemId}: judgment generator mismatch`);
    }
    const judges = new Set(js.map((j) => j.judgeModel));
    for (const judge of judges) {
      const ranks = js.filter((j) => j.judgeModel === judge).map((j) => j.originalRank).sort((a, b) => a! - b!);
      if (ranks.join() !== rs.map((_, i) => i + 1).join()) problems.push(`${itemId}: judge ${judge} ranks are not 1..${rs.length}`);
    }
  }
  for (const a of asg) {
    const ids = new Set((respByItem.get(a.itemId) ?? []).map((r) => r.responseId));
    const order = a.presentationOrder;
    if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
      problems.push(`assignment ${a.assignmentId}: presentation order is not a permutation of the item's responses`);
    }
  }
  return {
    ok: problems.length === 0,
    items: allItems.length,
    responses: allResponses.length,
    judgmentRows: judg.length,
    assignments: asg.length,
    problems: problems.slice(0, 200),
  };
}
