// Deterministic transformation of the MedSP1000 artifacts into study-bundle
// items. Pure functions: no file or network access.
//
// Physicians see exactly what the LLM judges saw in the full-trajectory (8-turn)
// condition: the clinician initialization (`question_text`) and each candidate's
// `transcript_text`. The patient-only `private_patient_context` is never copied
// into the bundle.
import { hashSort, sha256Hex } from "../hash";
import { RUBRIC_AXES, type BundleItem, type BundleJudgmentRow, type BundleResponse, type TranscriptTurn } from "./bundle";
import { responseIdFor, selectJudgments, type SourceJudgment } from "./realPocqi";

export const MEDSP_DATASET = "byrLLCC/MedSP1000";
export const MEDSP_JUDGING_EXPERIMENT = "medsp1000_all_eight_judges_v2";
export const MEDSP_TURN_COUNT = 8;
export const MEDSP_CANDIDATES = 8;

export interface SourceScenario {
  question_id: string;
  question_text: string;
  private_patient_context: string;
  source_dataset: string;
  source_revision: string;
  source_scenario_path: string;
  question_text_sha256: string;
}

export interface SourceConversation {
  generation_id: string;
  generation_key: string;
  experiment_id: string;
  run_id: string;
  status: string;
  question_id: string;
  question_text: string;
  clinician_model: string;
  patient_model: string;
  prompt_version: string;
  exchange_count: number;
  turn_count: number;
  turns: { turn_index: number; role: string; content: string }[];
  transcript_text: string;
  attempt: number;
  created_at: string;
}

class DataValidationError extends Error {}
function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new DataValidationError(message);
}

export function selectMedspJudgments(rows: Iterable<SourceJudgment>) {
  return selectJudgments(rows, MEDSP_JUDGING_EXPERIMENT);
}

/** Simple random sample of scenarios (hashSort with the seed); the first k form any k-scenario pilot. */
export function sampleScenarios(ids: readonly string[], size: number, seed: string): string[] {
  check(size <= ids.length, `sample size ${size} > ${ids.length} scenarios`);
  return hashSort(ids, `${seed}:order`, (id) => id).slice(0, size);
}

/** The transcript format the judging pipeline gave the judges: "ROLE: content" lines. */
export function renderTranscript(turns: readonly { role: string; content: string }[]): string {
  return turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
}

export function buildMedspItem(params: {
  scenario: SourceScenario;
  sampleIndex: number;
  judgments: SourceJudgment[];
  conversationsById: Map<string, SourceConversation>;
}): BundleItem {
  const { scenario, sampleIndex, judgments, conversationsById } = params;
  const qid = scenario.question_id;
  check(judgments.length === MEDSP_CANDIDATES, `${qid}: expected 8 judges, found ${judgments.length}`);
  check(
    new Set(judgments.map((j) => j.candidates.map((c) => c.generation_id).sort().join("|"))).size === 1,
    `${qid}: judges saw different candidate conversations`,
  );
  const reference = judgments[0];
  check(reference.candidates.length === MEDSP_CANDIDATES, `${qid}: expected 8 candidates`);
  check(
    new Set(reference.candidates.map((c) => c.generator_model)).size === MEDSP_CANDIDATES,
    `${qid}: duplicate clinician model among candidates`,
  );

  const responses: BundleResponse[] = [...reference.candidates]
    .sort((a, b) => (a.generation_id < b.generation_id ? -1 : 1))
    .map((c) => {
      const conv = conversationsById.get(c.generation_id);
      check(conv, `${qid}: conversation ${c.generation_id} not found`);
      check(conv.status === "succeeded", `${qid}: conversation ${c.generation_id} did not succeed`);
      check(conv.question_id === qid, `${qid}: conversation ${c.generation_id} belongs to ${conv.question_id}`);
      check(conv.clinician_model === c.generator_model, `${qid}: clinician model mismatch for ${c.generation_id}`);
      check(conv.question_text === scenario.question_text, `${qid}: case text drift in ${c.generation_id}`);
      check(conv.turn_count === MEDSP_TURN_COUNT && conv.turns.length === MEDSP_TURN_COUNT, `${qid}: ${c.generation_id} is not 8 turns`);
      conv.turns.forEach((t, i) =>
        check(t.role === (i % 2 === 0 ? "clinician" : "patient"), `${qid}: ${c.generation_id} turn ${i + 1} has role ${t.role}`),
      );
      // The judges received transcript_text; the turns must render to exactly that text.
      check(renderTranscript(conv.turns) === conv.transcript_text, `${qid}: ${c.generation_id} turns do not match transcript_text`);
      const transcript: TranscriptTurn[] = conv.turns.map((t) => ({ role: t.role as TranscriptTurn["role"], content: t.content }));
      return {
        response_id: responseIdFor(conv.generation_id),
        response_text: conv.transcript_text,
        transcript,
        provenance: {
          generator_model: conv.clinician_model,
          generator_family: c.generator_family,
          generation_id: conv.generation_id,
          generation_key: conv.generation_key,
          run_id: conv.run_id,
          experiment_id: conv.experiment_id,
          response_text_sha256: sha256Hex(conv.transcript_text),
          metadata: {
            patient_model: conv.patient_model,
            prompt_version: conv.prompt_version,
            exchange_count: conv.exchange_count,
            turn_count: conv.turn_count,
            attempt: conv.attempt,
            created_at: conv.created_at,
          },
        },
      };
    });
  const responseIdByGeneration = new Map(responses.map((r) => [r.provenance.generation_id, r.response_id]));

  const llm_judgments: BundleJudgmentRow[] = [];
  for (const j of [...judgments].sort((a, b) => (a.judge_model < b.judge_model ? -1 : 1))) {
    check(j.question_text === scenario.question_text, `${qid}: case text drift in judgment ${j.judgment_id}`);
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
      check(scores && RUBRIC_AXES.every((a) => typeof scores[a] === "number"), `${qid}: judgment ${j.judgment_id} incomplete scores`);
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
        scores: Object.fromEntries(RUBRIC_AXES.map((a) => [a, scores[a]])) as BundleJudgmentRow["scores"],
      });
    }
  }

  return {
    item_id: `medsp_${qid}__t${MEDSP_TURN_COUNT}`,
    study: "medsp1000",
    source_question_id: qid,
    source_dataset: scenario.source_dataset,
    item_type: "multi_turn",
    specialty: null,
    question_text: scenario.question_text,
    turn_count: MEDSP_TURN_COUNT,
    sample_index: sampleIndex,
    provenance: {
      source_revision: scenario.source_revision,
      source_scenario_path: scenario.source_scenario_path,
      question_text_sha256: sha256Hex(scenario.question_text),
      visible_turns: MEDSP_TURN_COUNT,
    },
    responses,
    llm_judgments,
  };
}
