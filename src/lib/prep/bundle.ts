// The study-bundle format both preparation scripts write and the importer reads.
import type { StudyId } from "../studies";

export const RUBRIC_AXES = ["accuracy", "clinical_utility", "source_quality", "verifiability", "completeness"] as const;

export interface TranscriptTurn {
  role: "clinician" | "patient";
  content: string;
}

export interface BundleResponse {
  response_id: string;
  /** Exactly the text the LLM judges were given for this candidate. */
  response_text: string;
  /** Multi-turn only: the same content split into role turns (role + text only). */
  transcript?: TranscriptTurn[] | null;
  provenance: {
    generator_model: string;
    generator_family: string;
    generation_id: string;
    generation_key: string;
    run_id: string;
    experiment_id: string;
    response_text_sha256: string;
    metadata: Record<string, unknown>;
  };
}

export interface BundleJudgmentRow {
  judgment_id: string;
  judging_condition: string;
  experiment_id: string;
  judge_model: string;
  judge_family: string;
  response_id: string;
  generator_model: string;
  judge_presentation_label: string;
  original_rank: number;
  scores: Record<(typeof RUBRIC_AXES)[number], number>;
}

export interface BundleItem {
  item_id: string;
  study: StudyId;
  source_question_id: string;
  source_dataset: string;
  item_type: "single_turn" | "multi_turn";
  specialty: string | null;
  question_text: string;
  turn_count: number | null;
  sample_index: number;
  provenance: Record<string, unknown>;
  responses: BundleResponse[];
  llm_judgments: BundleJudgmentRow[];
}
