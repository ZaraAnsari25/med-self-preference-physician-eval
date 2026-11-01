// Test helpers. Fixture text is obviously synthetic placeholder text, used only
// to exercise code paths; it is never shown to reviewers.
import { openPglite, type DB } from "@/db";
import { sha256Hex } from "@/lib/hash";
import type { BundleItem } from "@/lib/prep/bundle";
import { responseIdFor } from "@/lib/prep/realPocqi";
import { createUser } from "@/server/auth";
import type { StudyBundle } from "@/server/importer";
import { emptyEvaluationState, type EvaluationState } from "@/lib/evaluation";
import { presentationLabels } from "@/lib/ordering";
import type { StudyId } from "@/lib/studies";

export const MODELS = [
  ["gpt-5.6-sol", "openai"],
  ["gpt-5.6-terra", "openai"],
  ["claude-opus-5", "anthropic"],
  ["claude-sonnet-5", "anthropic"],
  ["gemini-3.1-pro-preview", "google"],
  ["gemini-3.7-flash", "google"],
  ["Qwen/Qwen3.5-122B-A10B-FP8", "qwen"],
  ["Qwen/Qwen3.8-27B-FP8", "qwen"],
] as const;

/** Synthetic patient-only text: must never reach a physician payload. */
export const FIXTURE_PRIVATE_CONTEXT = "SECRET-PATIENT-SCRIPT";

export function fixtureBundle(
  nItems: number,
  study: StudyId = "real_pocqi",
  opts: { specialties?: string[] } = {},
): StudyBundle {
  const specialties = opts.specialties ?? ["Fixture Specialty"];
  const multi = study === "medsp1000";
  const items: BundleItem[] = Array.from({ length: nItems }, (_, i) => {
    const qid = `fixture-${study}-q-${i}`;
    const responses = MODELS.map(([model, fam], k) => {
      const genId = `gen-fixture-${study}-${i}-${k}`;
      const transcript = multi
        ? Array.from({ length: 8 }, (_, t) => ({
            role: (t % 2 === 0 ? "clinician" : "patient") as "clinician" | "patient",
            content: `[synthetic turn ${t + 1} of conversation ${i}-${k}]`,
          }))
        : null;
      const text = transcript
        ? transcript.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n")
        : `[synthetic fixture response ${i}-${k}]\n\n**Bold** and a list:\n\n- one\n- two`;
      return {
        response_id: responseIdFor(genId),
        response_text: text,
        transcript,
        provenance: {
          generator_model: model,
          generator_family: fam,
          generation_id: genId,
          generation_key: `key-${genId}`,
          run_id: "run-fixture",
          experiment_id: "fixture",
          response_text_sha256: sha256Hex(text),
          metadata: {},
        },
      };
    });
    const llm_judgments = MODELS.flatMap(([judge, judgeFam], jk) =>
      responses.map((r, rk) => ({
        judgment_id: `judgment-${study}-${i}-${jk}`,
        judging_condition: "rubric_and_model_ranking",
        experiment_id: "fixture",
        judge_model: judge,
        judge_family: judgeFam,
        response_id: r.response_id,
        generator_model: r.provenance.generator_model,
        judge_presentation_label: `response-${rk + 1}`,
        original_rank: ((rk + jk) % 8) + 1,
        scores: { accuracy: 4, clinical_utility: 3.5, source_quality: 2, verifiability: 3, completeness: 4.5 },
      })),
    );
    return {
      item_id: multi ? `medsp_${qid}__t8` : `pocqi_${qid}`,
      study,
      source_question_id: qid,
      source_dataset: "fixture",
      item_type: multi ? ("multi_turn" as const) : ("single_turn" as const),
      specialty: multi ? null : specialties.at(i % specialties.length)!,
      question_text: `[synthetic fixture ${multi ? "case" : "question"} ${i}]`,
      turn_count: multi ? 8 : null,
      sample_index: i,
      provenance: {},
      responses,
      llm_judgments,
    };
  });
  return { meta: { study_seed: `test-seed-${study}` }, items };
}

export async function freshDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const h = openPglite();
  await h.migrate();
  return { db: h.db, close: h.close };
}

export async function makeReviewer(db: DB, username: string) {
  return createUser(db, { username, password: "correct-horse-battery", role: "reviewer" });
}

/** A complete evaluation: all scores, a confirmed reversed-alphabetical ranking. */
export function completeState(n = 8): EvaluationState {
  const labels = presentationLabels(n);
  const s = emptyEvaluationState(labels);
  labels.forEach((l, i) => {
    s.responses[l].scores = { accuracy: i % 6, clinical_utility: 5, source_quality: 0, verifiability: 3, completeness: 4 };
  });
  s.ranking = [...labels].reverse();
  s.rankingConfirmed = true;
  s.rankingModified = true;
  return s;
}
