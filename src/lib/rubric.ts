// Shared between server and client: no Node imports here.

/** The five Real-POCQi axes, worded exactly as in the original judge prompt. */
export const RUBRIC_CRITERIA = [
  { key: "accuracy", label: "Accuracy", question: "How factually accurate is the response?" },
  {
    key: "clinical_utility",
    label: "Clinical utility",
    question: "How useful is the response for providing high-quality clinical care?",
  },
  {
    key: "source_quality",
    label: "Source quality",
    question: "How authoritative is the source material supporting the response?",
  },
  { key: "verifiability", label: "Verifiability", question: "How easy is the response to verify?" },
  {
    key: "completeness",
    label: "Completeness",
    question: "How completely does the response address the question?",
  },
] as const;

/**
 * The same five axes in the MedSP1000 (multi-turn) wording, exactly as in the
 * original judge prompt (src/judging/judge_medsp1000.py, full-trajectory view).
 */
export const RUBRIC_CRITERIA_MULTI_TURN = [
  {
    key: "accuracy",
    label: "Accuracy",
    question: "How factually and clinically accurate are the clinician's statements across the encounter?",
  },
  {
    key: "clinical_utility",
    label: "Clinical utility",
    question: "How useful is the clinician's overall interaction for providing high-quality clinical care?",
  },
  {
    key: "source_quality",
    label: "Source quality",
    question:
      "How well grounded are the clinician's claims and recommendations in authoritative clinical knowledge? Do not require formal citations in dialogue.",
  },
  {
    key: "verifiability",
    label: "Verifiability",
    question: "How specific, transparent, and checkable are the clinician's claims, reasoning, and recommendations?",
  },
  {
    key: "completeness",
    label: "Completeness",
    question: "How completely does the clinician address the scenario using the information available over the full interaction?",
  },
] as const;

export type Criterion = { key: CriterionKey; label: string; question: string };
export type CriterionKey = (typeof RUBRIC_CRITERIA)[number]["key"];
export const CRITERION_KEYS = RUBRIC_CRITERIA.map((c) => c.key) as CriterionKey[];
export const SCORE_VALUES = [0, 1, 2, 3, 4, 5] as const;

/** Separate physician-only instrument; not part of the original LLM rubric. */
export const ERROR_FLAG_VALUES = ["yes", "no", "uncertain"] as const;
export type ErrorFlag = (typeof ERROR_FLAG_VALUES)[number];

export const ERROR_CATEGORIES = [
  { key: "incorrect_information", label: "Incorrect medical information" },
  { key: "unsafe_treatment", label: "Incorrect or unsafe treatment recommendation" },
  { key: "missing_contraindication", label: "Missing important contraindication" },
  { key: "medication_or_dose", label: "Incorrect medication or dosage" },
  { key: "important_omission", label: "Important omission" },
  { key: "other", label: "Other clinical concern" },
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]["key"];
export const ERROR_CATEGORY_KEYS = ERROR_CATEGORIES.map((c) => c.key) as ErrorCategory[];

export type RubricMode = "required" | "optional" | "off";
export type ErrorMode = "optional" | "off";
export interface InstrumentConfig {
  rubricMode: RubricMode;
  errorMode: ErrorMode;
}
export const DEFAULT_INSTRUMENT_CONFIG: InstrumentConfig = { rubricMode: "required", errorMode: "optional" };
