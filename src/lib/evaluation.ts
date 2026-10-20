// Shared evaluation state + validation (server and client). Responses are
// keyed by their blinded display label ("A".."H"); the server translates
// labels to internal response IDs using the assignment's stored order.
import { z } from "zod";
import {
  CRITERION_KEYS,
  ERROR_CATEGORY_KEYS,
  ERROR_FLAG_VALUES,
  type CriterionKey,
  type ErrorCategory,
  type ErrorFlag,
  type InstrumentConfig,
} from "./rubric";

export interface ResponseEvaluation {
  scores: Partial<Record<CriterionKey, number | null>>;
  errorFlag: ErrorFlag | null;
  errorCategories: ErrorCategory[];
  errorNote: string;
}

export interface EvaluationState {
  /** Labels from best (rank 1) to worst; null until the physician orders them. */
  ranking: string[] | null;
  rankingConfirmed: boolean;
  /** True once the physician has moved any entry (vs. confirming the initial order). */
  rankingModified: boolean;
  responses: Record<string, ResponseEvaluation>;
}

export function emptyResponseEvaluation(): ResponseEvaluation {
  return { scores: {}, errorFlag: null, errorCategories: [], errorNote: "" };
}

export function emptyEvaluationState(labels: readonly string[]): EvaluationState {
  return {
    ranking: null,
    rankingConfirmed: false,
    rankingModified: false,
    responses: Object.fromEntries(labels.map((l) => [l, emptyResponseEvaluation()])),
  };
}

const scoreSchema = z.number().int().min(0).max(5).nullable();

export const MAX_NOTE_LENGTH = 4000;

export const evaluationStateSchema = z.object({
  ranking: z.array(z.string()).nullable(),
  rankingConfirmed: z.boolean(),
  rankingModified: z.boolean(),
  responses: z.record(
    z.string(),
    z.object({
      scores: z.object(Object.fromEntries(CRITERION_KEYS.map((k) => [k, scoreSchema.optional()]))).strict(),
      errorFlag: z.enum(ERROR_FLAG_VALUES).nullable(),
      errorCategories: z.array(z.enum(ERROR_CATEGORY_KEYS as [ErrorCategory, ...ErrorCategory[]])),
      errorNote: z.string().max(MAX_NOTE_LENGTH),
    }),
  ),
});

/** A strict ranking: a permutation of all labels, no duplicates, no omissions. */
export function rankingProblems(labels: readonly string[], ranking: readonly string[] | null): string[] {
  if (!ranking) return ["Responses have not been ranked yet."];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const l of ranking) {
    if (!labels.includes(l)) problems.push(`Unknown response "${l}" in ranking.`);
    else if (seen.has(l)) problems.push(`Response ${l} is ranked more than once.`);
    seen.add(l);
  }
  const missing = labels.filter((l) => !seen.has(l));
  if (missing.length) problems.push(`Missing from ranking: ${missing.join(", ")}.`);
  return problems;
}

export function scoreSum(e: ResponseEvaluation): number | null {
  const vals = CRITERION_KEYS.map((k) => e.scores[k]);
  if (vals.some((v) => v === null || v === undefined)) return null;
  return (vals as number[]).reduce((a, b) => a + b, 0);
}

/** Everything still required before this question counts as complete. */
export function completionProblems(
  labels: readonly string[],
  state: EvaluationState,
  config: InstrumentConfig,
): string[] {
  const problems: string[] = [];
  if (config.rubricMode === "required") {
    const unscored = labels.filter((l) => scoreSum(state.responses[l] ?? emptyResponseEvaluation()) === null);
    if (unscored.length) problems.push(`Rubric scores missing for ${unscored.map((l) => `Response ${l}`).join(", ")}.`);
  }
  const rp = rankingProblems(labels, state.ranking);
  if (rp.length) problems.push(...rp);
  else if (!state.rankingConfirmed) problems.push("Ranking has not been confirmed.");
  return problems;
}

/** Whether the physician has entered anything at all. */
export function hasAnyInput(state: EvaluationState): boolean {
  if (state.ranking || state.rankingConfirmed) return true;
  return Object.values(state.responses).some(
    (r) =>
      Object.values(r.scores).some((v) => v !== null && v !== undefined) ||
      r.errorFlag !== null ||
      r.errorCategories.length > 0 ||
      r.errorNote.trim() !== "",
  );
}
