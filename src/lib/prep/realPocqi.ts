// Deterministic transformation of the original research artifacts into the
// study bundle the app imports. Pure functions: no file or network access.
import { hashSort, sha256Hex } from "../hash";
import { RUBRIC_AXES as AXES, type BundleItem, type BundleJudgmentRow, type BundleResponse } from "./bundle";

export type { BundleItem, BundleJudgmentRow, BundleResponse } from "./bundle";

export const REAL_POCQI_DATASET = "jjfenglab/Real-POCQi";
export const PRODUCTION_JUDGING_EXPERIMENT = "real_pocqi_combined_all_judges_v1";
export const JUDGING_CONDITION = "rubric_and_model_ranking";
export const EXPECTED_RESPONSES_PER_QUESTION = 8;

export interface SourceQuestion {
  question_id: string;
  question_text: string;
  specialty: string;
  source_dataset: string;
  source_revision: string;
  source_file: string;
  source_row_index: number;
}

export interface SourceGeneration {
  generation_id: string;
  generation_key: string;
  experiment_id: string;
  run_id: string;
  status: string;
  question_id: string;
  question_text: string;
  specialty: string;
  generator_family: string;
  generator_model: string;
  generator_model_version?: string;
  prompt_template_id: string;
  response_text: string;
  finish_reason: string | null;
  output_tokens: number | null;
  created_at: string;
  attempt: number;
}

export interface SourceJudgment {
  experiment_id: string;
  judgment_id: string;
  status: string;
  judging_case: string;
  question_id: string;
  question_text: string;
  specialty: string;
  judge_family: string;
  judge_model: string;
  prompt_template_id: string;
  seed: number | null;
  candidates: { response_id: string; generation_id: string; generator_family: string; generator_model: string }[];
  result: {
    scored_responses: { response_id: string; scores: Record<string, number> }[];
    model_ranking?: { response_ids: string[] };
  } | null;
}

/** Stable internal response ID derived from the original generation ID. */
export function responseIdFor(generationId: string): string {
  return `rsp_${sha256Hex(`response:${generationId}`).slice(0, 20)}`;
}

/** Same rule as the research analysis: last successful row per (question, judge) in file order. */
export function selectJudgments(rows: Iterable<SourceJudgment>, experimentId = PRODUCTION_JUDGING_EXPERIMENT) {
  const cells = new Map<string, SourceJudgment>();
  for (const row of rows) {
    if (row.experiment_id !== experimentId || row.status !== "succeeded") continue;
    cells.set(`${row.question_id}\u0000${row.judge_model}`, row);
  }
  const byQuestion = new Map<string, SourceJudgment[]>();
  for (const row of cells.values()) {
    const list = byQuestion.get(row.question_id) ?? [];
    list.push(row);
    byQuestion.set(row.question_id, list);
  }
  return byQuestion;
}

/**
 * Stratified sample: proportional allocation by specialty (largest remainder,
 * at least one per specialty), questions chosen within each specialty by
 * hashSort, then the whole sample ordered by hashSort. The first k of that
 * order form any k-question pilot (e.g. the 5-question prototype).
 */
export function stratifiedSample(questions: readonly SourceQuestion[], size: number, seed: string): SourceQuestion[] {
  const strata = new Map<string, SourceQuestion[]>();
  for (const q of questions) {
    const list = strata.get(q.specialty) ?? [];
    list.push(q);
    strata.set(q.specialty, list);
  }
  const specialties = [...strata.keys()].sort();
  if (size < specialties.length) throw new Error(`sample size ${size} < ${specialties.length} specialties`);
  if (size > questions.length) throw new Error(`sample size ${size} > ${questions.length} questions`);

  const total = questions.length;
  const alloc = new Map<string, number>();
  const quotas = specialties.map((s) => {
    const exact = (strata.get(s)!.length / total) * size;
    return { s, exact, base: Math.max(1, Math.floor(exact)) };
  });
  quotas.forEach((q) => alloc.set(q.s, Math.min(q.base, strata.get(q.s)!.length)));
  let remaining = size - [...alloc.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...quotas].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || (a.s < b.s ? -1 : 1));
  while (remaining > 0) {
    let progressed = false;
    for (const q of byRemainder) {
      if (remaining === 0) break;
      if (alloc.get(q.s)! < strata.get(q.s)!.length) {
        alloc.set(q.s, alloc.get(q.s)! + 1);
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) throw new Error("cannot allocate sample");
  }
  while (remaining < 0) {
    // Too many from the "at least one" floor: trim the largest allocations.
    const largest = [...alloc.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    alloc.set(largest[0], largest[1] - 1);
    remaining++;
  }

  const chosen = specialties.flatMap((s) =>
    hashSort(strata.get(s)!, `${seed}:stratum:${s}`, (q) => q.question_id).slice(0, alloc.get(s)!),
  );
  return hashSort(chosen, `${seed}:order`, (q) => q.question_id);
}

export class DataValidationError extends Error {}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new DataValidationError(message);
}

export function buildItem(params: {
  question: SourceQuestion;
  sampleIndex: number;
  judgments: SourceJudgment[];
  generationsById: Map<string, SourceGeneration>;
}): BundleItem {
  const { question, sampleIndex, judgments, generationsById } = params;
  const qid = question.question_id;
  check(judgments.length === EXPECTED_RESPONSES_PER_QUESTION, `${qid}: expected 8 judges, found ${judgments.length}`);

  // Every judge must have judged the exact same set of generations.
  const genSets = judgments.map((j) => j.candidates.map((c) => c.generation_id).sort().join("|"));
  check(new Set(genSets).size === 1, `${qid}: judges saw different candidate generations`);

  const reference = judgments[0];
  check(
    reference.candidates.length === EXPECTED_RESPONSES_PER_QUESTION,
    `${qid}: expected 8 candidates, found ${reference.candidates.length}`,
  );
  check(
    new Set(reference.candidates.map((c) => c.generator_model)).size === EXPECTED_RESPONSES_PER_QUESTION,
    `${qid}: duplicate generator model among candidates`,
  );

  const responses: BundleResponse[] = [...reference.candidates]
    .sort((a, b) => (a.generation_id < b.generation_id ? -1 : 1))
    .map((c) => {
      const gen = generationsById.get(c.generation_id);
      check(gen, `${qid}: generation ${c.generation_id} not found`);
      check(gen.status === "succeeded", `${qid}: generation ${c.generation_id} did not succeed`);
      check(gen.question_id === qid, `${qid}: generation ${c.generation_id} belongs to ${gen.question_id}`);
      check(gen.generator_model === c.generator_model, `${qid}: generator mismatch for ${c.generation_id}`);
      check(gen.question_text === question.question_text, `${qid}: question text drift in generation`);
      check(gen.response_text.trim().length > 0, `${qid}: empty response ${c.generation_id}`);
      return {
        response_id: responseIdFor(gen.generation_id),
        response_text: gen.response_text,
        provenance: {
          generator_model: gen.generator_model,
          generator_family: gen.generator_family,
          generation_id: gen.generation_id,
          generation_key: gen.generation_key,
          run_id: gen.run_id,
          experiment_id: gen.experiment_id,
          response_text_sha256: sha256Hex(gen.response_text),
          metadata: {
            generator_model_version: gen.generator_model_version ?? null,
            prompt_template_id: gen.prompt_template_id,
            finish_reason: gen.finish_reason,
            output_tokens: gen.output_tokens,
            attempt: gen.attempt,
            created_at: gen.created_at,
          },
        },
      };
    });
  const responseIdByGeneration = new Map(responses.map((r) => [r.provenance.generation_id, r.response_id]));

  const llm_judgments: BundleJudgmentRow[] = [];
  for (const j of [...judgments].sort((a, b) => (a.judge_model < b.judge_model ? -1 : 1))) {
    check(j.question_text === question.question_text, `${qid}: question text drift in judgment ${j.judgment_id}`);
    check(j.specialty === question.specialty, `${qid}: specialty drift in judgment ${j.judgment_id}`);
    check(j.result?.model_ranking, `${qid}: judgment ${j.judgment_id} has no model ranking`);
    const labels = j.candidates.map((c) => c.response_id);
    const ranking = j.result.model_ranking.response_ids;
    check(
      ranking.length === labels.length && new Set(ranking).size === labels.length && ranking.every((r) => labels.includes(r)),
      `${qid}: judgment ${j.judgment_id} ranking is not a permutation`,
    );
    const scoresByLabel = new Map(j.result.scored_responses.map((s) => [s.response_id, s.scores]));
    for (const c of j.candidates) {
      const scores = scoresByLabel.get(c.response_id);
      check(scores, `${qid}: judgment ${j.judgment_id} missing scores for ${c.response_id}`);
      check(AXES.every((a) => typeof scores[a] === "number"), `${qid}: judgment ${j.judgment_id} incomplete scores`);
      llm_judgments.push({
        judgment_id: j.judgment_id,
        judging_condition: j.judging_case,
        experiment_id: j.experiment_id,
        judge_model: j.judge_model,
        judge_family: j.judge_family,
        response_id: responseIdByGeneration.get(c.generation_id)!,
        generator_model: c.generator_model,
        judge_presentation_label: c.response_id,
        original_rank: ranking.indexOf(c.response_id) + 1,
        scores: Object.fromEntries(AXES.map((a) => [a, scores[a]])) as BundleJudgmentRow["scores"],
      });
    }
  }

  return {
    item_id: `pocqi_${qid}`,
    study: "real_pocqi",
    source_question_id: qid,
    source_dataset: question.source_dataset,
    item_type: "single_turn",
    specialty: question.specialty,
    question_text: question.question_text,
    turn_count: null,
    sample_index: sampleIndex,
    provenance: {
      source_revision: question.source_revision,
      source_file: question.source_file,
      source_row_index: question.source_row_index,
      question_text_sha256: sha256Hex(question.question_text),
    },
    responses,
    llm_judgments,
  };
}
