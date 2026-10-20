// Physician-facing data access. BLINDING RULE: nothing in this module may read
// `response_provenance` or `llm_judgments`, and payloads identify responses
// only by display label ("A".."H"), never by internal response ID.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { assignments, items, responseEvaluations, responses, saveEvents, users } from "@/db/schema";
import {
  completionProblems,
  emptyEvaluationState,
  evaluationStateSchema,
  hasAnyInput,
  rankingProblems,
  type EvaluationState,
} from "@/lib/evaluation";
import { presentationLabels } from "@/lib/ordering";
import { CRITERION_KEYS, type CriterionKey, type InstrumentConfig } from "@/lib/rubric";
import { getInstrumentConfig } from "./settings";

export type AssignmentStatus = "not_started" | "in_progress" | "complete";

export interface QueueEntry {
  position: number; // 1-based
  status: AssignmentStatus;
}

export interface PhysicianResponse {
  label: string;
  contentFormat: "markdown" | "transcript";
  text: string;
  transcript: { role: "clinician" | "patient"; content: string }[] | null;
}

export interface PhysicianItemPayload {
  position: number;
  total: number;
  item: {
    itemType: "single_turn" | "multi_turn";
    specialty: string | null;
    questionText: string;
    context: unknown;
    turnCount: number | null;
  };
  responses: PhysicianResponse[];
  state: EvaluationState;
  status: AssignmentStatus;
  revision: number;
  locked: boolean;
  config: InstrumentConfig;
}

export class EvaluationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const COLUMN: Record<CriterionKey, keyof typeof responseEvaluations.$inferSelect> = {
  accuracy: "accuracy",
  clinical_utility: "clinicalUtility",
  source_quality: "sourceQuality",
  verifiability: "verifiability",
  completeness: "completeness",
};

export async function listQueue(db: DB, reviewerId: string): Promise<QueueEntry[]> {
  const rows = await db
    .select({ queuePosition: assignments.queuePosition, status: assignments.status })
    .from(assignments)
    .where(eq(assignments.reviewerId, reviewerId))
    .orderBy(asc(assignments.queuePosition));
  return rows.map((r, i) => ({ position: i + 1, status: r.status }));
}

/** First position that is not complete, else the last one. */
export function resumePosition(queue: QueueEntry[]): number | null {
  if (!queue.length) return null;
  return (queue.find((q) => q.status !== "complete") ?? queue[queue.length - 1]).position;
}

async function assignmentAt(db: DB, reviewerId: string, position: number) {
  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.reviewerId, reviewerId))
    .orderBy(asc(assignments.queuePosition))
    .limit(1)
    .offset(position - 1);
  if (!Number.isInteger(position) || position < 1 || !rows[0]) throw new EvaluationError("Question not found", 404);
  return rows[0];
}

function stateFromRows(
  labels: string[],
  order: string[],
  rows: (typeof responseEvaluations.$inferSelect)[],
  assignment: typeof assignments.$inferSelect,
): EvaluationState {
  const state = emptyEvaluationState(labels);
  const byId = new Map(rows.map((r) => [r.responseId, r]));
  const ranked: { label: string; rank: number }[] = [];
  order.forEach((responseId, i) => {
    const label = labels[i];
    const r = byId.get(responseId);
    if (!r) return;
    state.responses[label] = {
      scores: Object.fromEntries(CRITERION_KEYS.map((k) => [k, r[COLUMN[k]] as number | null])),
      errorFlag: r.errorFlag,
      errorCategories: r.errorCategories as EvaluationState["responses"][string]["errorCategories"],
      errorNote: r.errorNote,
    };
    if (r.finalRank !== null) ranked.push({ label, rank: r.finalRank });
  });
  state.ranking = ranked.length === labels.length ? ranked.sort((a, b) => a.rank - b.rank).map((r) => r.label) : null;
  state.rankingConfirmed = assignment.rankingConfirmedAt !== null && state.ranking !== null;
  state.rankingModified = assignment.rankingModified;
  return state;
}

export async function loadEvaluation(db: DB, reviewerId: string, position: number): Promise<PhysicianItemPayload> {
  const a = await assignmentAt(db, reviewerId, position);
  const [[item], resp, evals, [{ total }], [user], config] = await Promise.all([
    db
      .select({
        itemType: items.itemType,
        specialty: items.specialty,
        questionText: items.questionText,
        context: items.context,
        turnCount: items.turnCount,
      })
      .from(items)
      .where(eq(items.itemId, a.itemId)),
    db
      .select({
        responseId: responses.responseId,
        contentFormat: responses.contentFormat,
        responseText: responses.responseText,
        transcript: responses.transcript,
      })
      .from(responses)
      .where(eq(responses.itemId, a.itemId)),
    db.select().from(responseEvaluations).where(eq(responseEvaluations.assignmentId, a.assignmentId)),
    db.select({ total: sql<number>`count(*)::int` }).from(assignments).where(eq(assignments.reviewerId, reviewerId)),
    db.select({ submittedAt: users.submittedAt }).from(users).where(eq(users.userId, reviewerId)),
    getInstrumentConfig(db),
  ]);
  const order = a.presentationOrder;
  const labels = presentationLabels(order.length);
  const byId = new Map(resp.map((r) => [r.responseId, r]));
  if (order.length !== resp.length || order.some((id) => !byId.has(id))) {
    throw new EvaluationError("Assignment order does not match the item's responses", 500);
  }
  return {
    position,
    total,
    item,
    responses: order.map((id, i) => {
      const r = byId.get(id)!;
      const transcript = Array.isArray(r.transcript)
        ? (r.transcript as { role: "clinician" | "patient"; content: string }[]).map((t) => ({ role: t.role, content: t.content }))
        : null;
      return { label: labels[i], contentFormat: r.contentFormat, text: r.responseText, transcript };
    }),
    state: stateFromRows(labels, order, evals, a),
    status: a.status,
    revision: a.revision,
    locked: user?.submittedAt !== null || a.submittedAt !== null,
    config,
  };
}

export interface SaveInput {
  state?: unknown;
  baseRevision: number;
  activeMsDelta?: number;
}

export interface SaveResult {
  revision: number;
  status: AssignmentStatus;
  problems: string[];
}

export async function saveEvaluation(db: DB, reviewerId: string, position: number, input: SaveInput): Promise<SaveResult> {
  const parsed = evaluationStateSchema.safeParse(input.state);
  if (!parsed.success) throw new EvaluationError(`Invalid evaluation: ${parsed.error.issues[0]?.message}`, 400);
  const state = parsed.data as EvaluationState;

  const a = await assignmentAt(db, reviewerId, position);
  const [user] = await db.select({ submittedAt: users.submittedAt }).from(users).where(eq(users.userId, reviewerId));
  if (user?.submittedAt || a.submittedAt) {
    throw new EvaluationError("Evaluations have been submitted and are locked. Contact the study team to reopen.", 423);
  }

  const order = a.presentationOrder;
  const labels = presentationLabels(order.length);
  const unknown = Object.keys(state.responses).filter((l) => !labels.includes(l));
  if (unknown.length) throw new EvaluationError(`Unknown responses: ${unknown.join(", ")}`, 400);
  if (state.ranking !== null) {
    const rp = rankingProblems(labels, state.ranking);
    if (rp.length) throw new EvaluationError(rp.join(" "), 400);
  }
  if (state.rankingConfirmed && state.ranking === null) throw new EvaluationError("Cannot confirm an empty ranking", 400);

  const config = await getInstrumentConfig(db);
  const problems = completionProblems(labels, state, config);
  const status: AssignmentStatus = problems.length === 0 ? "complete" : hasAnyInput(state) ? "in_progress" : "not_started";
  const now = new Date();
  const activeMsDelta = Math.max(0, Math.min(Math.round(input.activeMsDelta ?? 0), 10 * 60 * 1000));

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(assignments)
      .set({
        revision: sql`${assignments.revision} + 1`,
        status,
        rankingConfirmedAt: state.rankingConfirmed ? (a.rankingConfirmedAt ?? now) : null,
        rankingModified: state.rankingModified,
        instrumentConfig: config,
        activeMs: sql`${assignments.activeMs} + ${activeMsDelta}`,
        startedAt: a.startedAt ?? (status !== "not_started" ? now : null),
        completedAt: status === "complete" ? (a.completedAt ?? now) : null,
        lastSavedAt: now,
      })
      .where(
        and(
          eq(assignments.assignmentId, a.assignmentId),
          eq(assignments.revision, input.baseRevision),
          isNull(assignments.submittedAt),
        ),
      )
      .returning({ revision: assignments.revision });
    if (!updated.length) {
      throw new EvaluationError("This question was changed in another window. Reload to continue.", 409);
    }

    const rows = order.map((responseId, i) => {
      const label = labels[i];
      const r = state.responses[label] ?? { scores: {}, errorFlag: null, errorCategories: [], errorNote: "" };
      const rank = state.ranking ? state.ranking.indexOf(label) + 1 : null;
      return {
        assignmentId: a.assignmentId,
        responseId,
        displayLabel: label,
        finalRank: rank,
        accuracy: r.scores.accuracy ?? null,
        clinicalUtility: r.scores.clinical_utility ?? null,
        sourceQuality: r.scores.source_quality ?? null,
        verifiability: r.scores.verifiability ?? null,
        completeness: r.scores.completeness ?? null,
        errorFlag: r.errorFlag,
        errorCategories: r.errorFlag === "yes" ? r.errorCategories : [],
        errorNote: r.errorNote,
        updatedAt: now,
      };
    });
    await tx
      .insert(responseEvaluations)
      .values(rows)
      .onConflictDoUpdate({
        target: [responseEvaluations.assignmentId, responseEvaluations.responseId],
        set: {
          finalRank: sql`excluded.final_rank`,
          accuracy: sql`excluded.accuracy`,
          clinicalUtility: sql`excluded.clinical_utility`,
          sourceQuality: sql`excluded.source_quality`,
          verifiability: sql`excluded.verifiability`,
          completeness: sql`excluded.completeness`,
          errorFlag: sql`excluded.error_flag`,
          errorCategories: sql`excluded.error_categories`,
          errorNote: sql`excluded.error_note`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    await tx.insert(saveEvents).values({
      eventId: randomUUID(),
      assignmentId: a.assignmentId,
      revision: updated[0].revision,
      state,
      savedAt: now,
    });
    return { revision: updated[0].revision, status, problems };
  });
}

export async function acknowledgeInstructions(db: DB, reviewerId: string) {
  await db
    .update(users)
    .set({ instructionsAcknowledgedAt: new Date() })
    .where(and(eq(users.userId, reviewerId), isNull(users.instructionsAcknowledgedAt)));
}

export interface SubmissionSummary {
  total: number;
  complete: number;
  incomplete: number[]; // 1-based positions
  submittedAt: Date | null;
}

export async function submissionSummary(db: DB, reviewerId: string): Promise<SubmissionSummary> {
  const queue = await listQueue(db, reviewerId);
  const [user] = await db.select({ submittedAt: users.submittedAt }).from(users).where(eq(users.userId, reviewerId));
  return {
    total: queue.length,
    complete: queue.filter((q) => q.status === "complete").length,
    incomplete: queue.filter((q) => q.status !== "complete").map((q) => q.position),
    submittedAt: user?.submittedAt ?? null,
  };
}

/** Final submission: only when every assigned question is complete. Freezes all evaluations. */
export async function submitAll(db: DB, reviewerId: string): Promise<SubmissionSummary> {
  const summary = await submissionSummary(db, reviewerId);
  if (summary.submittedAt) return summary;
  if (summary.total === 0) throw new EvaluationError("No questions are assigned.", 400);
  if (summary.incomplete.length) {
    throw new EvaluationError(`Questions still incomplete: ${summary.incomplete.join(", ")}`, 400);
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(assignments)
      .set({ submittedAt: now })
      .where(and(eq(assignments.reviewerId, reviewerId), isNull(assignments.submittedAt)));
    await tx.update(users).set({ submittedAt: now }).where(eq(users.userId, reviewerId));
  });
  return { ...summary, submittedAt: now };
}

/** Admin-only: unlock a reviewer's submitted evaluations for revision. */
export async function reopenSubmission(db: DB, reviewerId: string) {
  await db.transaction(async (tx) => {
    await tx.update(assignments).set({ submittedAt: null }).where(eq(assignments.reviewerId, reviewerId));
    await tx.update(users).set({ submittedAt: null }).where(eq(users.userId, reviewerId));
  });
}
