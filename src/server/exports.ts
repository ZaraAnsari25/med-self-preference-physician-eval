// Administrator-only research exports. Rows are keyed by stable IDs
// (question_id, item_id, response_id, judgment_id); nothing is matched by text.
// Reviewers are identified only by pseudonymous reviewer_code.
import { asc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { assignments, items, llmJudgments, responseEvaluations, responseProvenance, responses, studyPlans, users } from "@/db/schema";
import { blockLabel, slotLabel, type StudyPlan } from "@/lib/plan";

export const EXPORT_DATASETS = [
  "rankings",
  "rubric_scores",
  "error_annotations",
  "assignments",
  "llm_judgments",
  "response_key",
  "analysis",
  "plan",
  "reviewers",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];
type Row = Record<string, string | number | boolean | null>;

const AXES = ["accuracy", "clinical_utility", "source_quality", "verifiability", "completeness"] as const;

function family(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt")) return "openai";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gemini")) return "google";
  if (m.includes("qwen")) return "qwen";
  return "unknown";
}

function meanSum(vals: (number | null)[]): { mean: number | null; sum: number | null } {
  if (vals.some((v) => v === null)) return { mean: null, sum: null };
  const sum = (vals as number[]).reduce((a, b) => a + b, 0);
  return { mean: Math.round((sum / vals.length) * 10000) / 10000, sum: Math.round(sum * 10000) / 10000 };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Physician evaluation rows joined with assignment/item/reviewer metadata (reviewers only, not admins). */
async function physicianRows(db: DB) {
  return db
    .select({ e: responseEvaluations, a: assignments, i: items, reviewerCode: users.reviewerCode })
    .from(responseEvaluations)
    .innerJoin(assignments, eq(assignments.assignmentId, responseEvaluations.assignmentId))
    .innerJoin(items, eq(items.itemId, assignments.itemId))
    .innerJoin(users, eq(users.userId, assignments.reviewerId))
    .where(eq(users.role, "reviewer"))
    .orderBy(asc(assignments.study), asc(users.reviewerCode), asc(assignments.queuePosition), asc(responseEvaluations.displayLabel));
}

function physicianBase(r: Awaited<ReturnType<typeof physicianRows>>[number]): Row {
  return {
    study: r.i.study,
    reviewer_code: r.reviewerCode,
    assignment_id: r.a.assignmentId,
    question_id: r.i.sourceQuestionId,
    item_id: r.i.itemId,
    source_dataset: r.i.sourceDataset,
    turn_count: r.i.turnCount,
    response_id: r.e.responseId,
    display_label: r.e.displayLabel,
    presentation_position: r.a.presentationOrder.indexOf(r.e.responseId) + 1,
    assignment_status: r.a.status,
    ...planFields(r.a),
  };
}

/** Where an assignment sits in its study plan (empty for manual assignments). */
function planFields(a: typeof assignments.$inferSelect): Row {
  return {
    plan_id: a.planId,
    physician_slot: a.planSlot === null ? null : slotLabel(a.planSlot),
    block: a.planId === null ? null : blockLabel(a.isCalibration ? null : a.planBlock),
    is_calibration: a.isCalibration,
    transferred: a.transferredAt !== null,
  };
}

function physicianScores(e: typeof responseEvaluations.$inferSelect): Row {
  const vals = [e.accuracy, e.clinicalUtility, e.sourceQuality, e.verifiability, e.completeness];
  const { mean, sum } = meanSum(vals);
  return {
    accuracy: e.accuracy,
    clinical_utility: e.clinicalUtility,
    source_quality: e.sourceQuality,
    verifiability: e.verifiability,
    completeness: e.completeness,
    mean_score: mean,
    sum_score: sum,
  };
}

async function judgmentRows(db: DB) {
  return db
    .select({ j: llmJudgments, i: items, p: responseProvenance })
    .from(llmJudgments)
    .innerJoin(items, eq(items.itemId, llmJudgments.itemId))
    .innerJoin(responseProvenance, eq(responseProvenance.responseId, llmJudgments.responseId))
    .orderBy(asc(items.study), asc(items.sampleIndex), asc(llmJudgments.judgeModel), asc(llmJudgments.originalRank));
}

function judgmentFields(j: typeof llmJudgments.$inferSelect, prefix: string): Row {
  const vals = [j.accuracy, j.clinicalUtility, j.sourceQuality, j.verifiability, j.completeness];
  const { mean, sum } = meanSum(vals);
  return {
    [`${prefix}judge_model`]: j.judgeModel,
    [`${prefix}judge_family`]: j.judgeFamily,
    [`${prefix}self_judge`]: j.judgeModel === j.generatorModel,
    [`${prefix}same_family_judge`]: j.judgeFamily === family(j.generatorModel),
    [`${prefix}judgment_id`]: j.judgmentId,
    [`${prefix}judging_condition`]: j.judgingCondition,
    [`${prefix}experiment_id`]: j.experimentId,
    [`${prefix}judge_presentation_label`]: j.judgePresentationLabel,
    [`${prefix}rank`]: j.originalRank,
    ...Object.fromEntries(AXES.map((a, k) => [`${prefix}${a}`, vals[k]])),
    [`${prefix}mean_score`]: mean,
    [`${prefix}sum_score`]: sum,
  };
}

export async function buildExport(db: DB, dataset: ExportDataset): Promise<Row[]> {
  switch (dataset) {
    case "rankings":
      return (await physicianRows(db)).map((r) => ({
        ...physicianBase(r),
        final_rank: r.e.finalRank,
        ranking_confirmed: r.a.rankingConfirmedAt !== null,
        ranking_confirmed_at: iso(r.a.rankingConfirmedAt),
        ranking_modified: r.a.rankingModified,
        saved_at: iso(r.e.updatedAt),
        submitted_at: iso(r.a.submittedAt),
      }));
    case "rubric_scores":
      return (await physicianRows(db)).map((r) => ({
        ...physicianBase(r),
        ...physicianScores(r.e),
        rubric_mode: (r.a.instrumentConfig as { rubricMode?: string } | null)?.rubricMode ?? null,
        saved_at: iso(r.e.updatedAt),
      }));
    case "error_annotations":
      return (await physicianRows(db)).map((r) => ({
        ...physicianBase(r),
        clinically_significant_error: r.e.errorFlag,
        error_categories: r.e.errorCategories.join(";"),
        error_note: r.e.errorNote,
        error_mode: (r.a.instrumentConfig as { errorMode?: string } | null)?.errorMode ?? null,
        saved_at: iso(r.e.updatedAt),
      }));
    case "assignments": {
      const rows = await db
        .select({ a: assignments, i: items, reviewerCode: users.reviewerCode })
        .from(assignments)
        .innerJoin(items, eq(items.itemId, assignments.itemId))
        .innerJoin(users, eq(users.userId, assignments.reviewerId))
        .where(eq(users.role, "reviewer"))
        .orderBy(asc(assignments.study), asc(users.reviewerCode), asc(assignments.queuePosition));
      return rows.map(({ a, i, reviewerCode }) => {
        const cfg = a.instrumentConfig as { rubricMode?: string; errorMode?: string } | null;
        return {
          study: i.study,
          reviewer_code: reviewerCode,
          assignment_id: a.assignmentId,
          question_id: i.sourceQuestionId,
          item_id: i.itemId,
          turn_count: i.turnCount,
          specialty: i.specialty,
          sample_index: i.sampleIndex,
          ...planFields(a),
          transferred_at: iso(a.transferredAt),
          queue_position: a.queuePosition + 1,
          presentation_order: a.presentationOrder.join(";"),
          status: a.status,
          ranking_confirmed_at: iso(a.rankingConfirmedAt),
          ranking_modified: a.rankingModified,
          rubric_mode: cfg?.rubricMode ?? null,
          error_mode: cfg?.errorMode ?? null,
          active_seconds: Math.round(a.activeMs / 1000),
          revision: a.revision,
          assigned_at: iso(a.assignedAt),
          started_at: iso(a.startedAt),
          completed_at: iso(a.completedAt),
          last_saved_at: iso(a.lastSavedAt),
          submitted_at: iso(a.submittedAt),
        };
      });
    }
    case "llm_judgments":
      return (await judgmentRows(db)).map(({ j, i, p }) => ({
        study: i.study,
        question_id: i.sourceQuestionId,
        item_id: i.itemId,
        turn_count: i.turnCount,
        response_id: j.responseId,
        generator_model: j.generatorModel,
        generator_family: p.generatorFamily,
        ...judgmentFields(j, ""),
      }));
    case "response_key": {
      const rows = await db
        .select({ p: responseProvenance, i: items })
        .from(responseProvenance)
        .innerJoin(responses, eq(responses.responseId, responseProvenance.responseId))
        .innerJoin(items, eq(items.itemId, responses.itemId))
        .orderBy(asc(items.study), asc(items.sampleIndex), asc(responseProvenance.generatorModel));
      return rows.map(({ p, i }) => ({
        study: i.study,
        question_id: i.sourceQuestionId,
        item_id: i.itemId,
        response_id: p.responseId,
        generator_model: p.generatorModel,
        generator_family: p.generatorFamily,
        generation_id: p.generationId,
        generation_key: p.generationKey,
        run_id: p.runId,
        experiment_id: p.experimentId,
        response_text_sha256: p.responseTextSha256,
      }));
    }
    case "plan": {
      const plans = await db.select().from(studyPlans).orderBy(asc(studyPlans.study));
      const live = await db
        .select({ planId: assignments.planId, itemId: assignments.itemId, slot: assignments.planSlot, code: users.reviewerCode })
        .from(assignments)
        .innerJoin(users, eq(users.userId, assignments.reviewerId))
        .where(isNull(assignments.transferredAt));
      const itemRows = new Map((await db.select().from(items)).map((i) => [i.itemId, i]));
      return plans.flatMap((p) => {
        const design = p.design as StudyPlan;
        const graders = (id: string) =>
          live
            .filter((a) => a.planId === p.planId && a.itemId === id)
            .sort((x, y) => x.slot! - y.slot!)
            .map((a) => `${slotLabel(a.slot!)}:${a.code}`)
            .join(";");
        const row = (id: string, block: number | null): Row => {
          const i = itemRows.get(id)!;
          return {
            study: p.study,
            plan_id: p.planId,
            plan_seed: p.seed,
            item_id: id,
            question_id: i.sourceQuestionId,
            specialty: i.specialty,
            sample_index: i.sampleIndex,
            block: blockLabel(block),
            is_calibration: block === null,
            graders: graders(id),
          };
        };
        return [...design.calibration.map((id) => row(id, null)), ...design.blocks.flatMap((b, i) => b.map((id) => row(id, i + 1)))];
      });
    }
    case "reviewers":
      return (await db.select().from(users).where(eq(users.role, "reviewer")).orderBy(asc(users.reviewerCode))).map((u) => ({
        reviewer_code: u.reviewerCode,
        specialty: u.specialty,
        years_in_practice: u.yearsInPractice,
        active: u.active,
      }));
    case "analysis": {
      const phys = await physicianRows(db);
      const judg = await judgmentRows(db);
      const prov = new Map((await db.select().from(responseProvenance)).map((p) => [p.responseId, p]));
      const byResponse = new Map<string, (typeof judg)[number][]>();
      for (const row of judg) byResponse.set(row.j.responseId, [...(byResponse.get(row.j.responseId) ?? []), row]);
      const out: Row[] = [];
      for (const r of phys) {
        const p = prov.get(r.e.responseId)!;
        const physician = {
          ...physicianBase(r),
          specialty: r.i.specialty,
          generator_model: p.generatorModel,
          generator_family: p.generatorFamily,
          physician_rank: r.e.finalRank,
          physician_ranking_confirmed: r.a.rankingConfirmedAt !== null,
          ...Object.fromEntries(Object.entries(physicianScores(r.e)).map(([k, v]) => [`physician_${k}`, v])),
          physician_error_flag: r.e.errorFlag,
          physician_error_categories: r.e.errorCategories.join(";"),
          physician_submitted: r.a.submittedAt !== null,
        };
        for (const { j } of byResponse.get(r.e.responseId) ?? []) out.push({ ...physician, ...judgmentFields(j, "llm_") });
      }
      return out;
    }
  }
}

function csvCell(v: Row[string]): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection in free text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n";
}
