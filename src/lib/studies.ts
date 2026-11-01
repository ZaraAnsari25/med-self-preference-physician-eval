// Study definitions shared by server and client: no Node imports here.
import { RUBRIC_CRITERIA, RUBRIC_CRITERIA_MULTI_TURN, type Criterion } from "./rubric";

export const STUDY_IDS = ["real_pocqi", "medsp1000"] as const;
export type StudyId = (typeof STUDY_IDS)[number];

export interface StudyDefinition {
  id: StudyId;
  name: string;
  /** One-line description of what the AI was doing, shown on the study picker. */
  task: string;
  /** What one graded unit is called ("question", "scenario"). */
  unitNoun: string;
  /** What each candidate is called ("Response", "Conversation"). */
  candidateNoun: string;
  /** Heading for the prompt panel. */
  promptLabel: string;
  criteria: readonly Criterion[];
}

export const STUDIES: Record<StudyId, StudyDefinition> = {
  real_pocqi: {
    id: "real_pocqi",
    name: "Real-POCQi",
    task: "Specialist answers to clinical questions from physicians",
    unitNoun: "question",
    candidateNoun: "Response",
    promptLabel: "Clinical question",
    criteria: RUBRIC_CRITERIA,
  },
  medsp1000: {
    id: "medsp1000",
    name: "MedSP1000",
    task: "Physician conversations with a simulated patient",
    unitNoun: "scenario",
    candidateNoun: "Conversation",
    promptLabel: "Case information",
    criteria: RUBRIC_CRITERIA_MULTI_TURN,
  },
};

export function isStudyId(value: string): value is StudyId {
  return (STUDY_IDS as readonly string[]).includes(value);
}
