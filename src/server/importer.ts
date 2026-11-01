import { inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { items, llmJudgments, responseProvenance, responses } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import type { BundleItem } from "@/lib/prep/bundle";
import type { StudyId } from "@/lib/studies";
import { setStudySeed } from "./settings";

export interface StudyBundle {
  meta: { study_seed: string; [k: string]: unknown };
  items: BundleItem[];
}

export interface ImportResult {
  inserted: number;
  unchanged: number;
}

/**
 * Insert-only import. Items already present are verified to be byte-identical
 * (question text and every response text hash); the importer never edits or
 * deletes original model output.
 */
export async function importBundle(db: DB, bundle: StudyBundle, opts: { limit?: number } = {}): Promise<ImportResult> {
  const selected = [...bundle.items].sort((a, b) => a.sample_index - b.sample_index).slice(0, opts.limit ?? bundle.items.length);
  for (const it of selected) {
    for (const r of it.responses) {
      if (sha256Hex(r.response_text) !== r.provenance.response_text_sha256) {
        throw new Error(`${it.item_id}: response ${r.response_id} text does not match its recorded hash`);
      }
    }
  }
  // Bundles written before studies existed carry no study tag: they are Real-POCQi.
  const studyOf = (it: BundleItem): StudyId => it.study ?? "real_pocqi";
  const studies = new Set(bundle.items.map(studyOf));
  if (studies.size !== 1) throw new Error("a bundle must contain items from exactly one study");
  await setStudySeed(db, [...studies][0], bundle.meta.study_seed);

  const ids = selected.map((i) => i.item_id);
  const existing = ids.length ? await db.select().from(items).where(inArray(items.itemId, ids)) : [];
  const existingResp = ids.length
    ? await db
        .select({ responseId: responses.responseId, itemId: responses.itemId, text: responses.responseText })
        .from(responses)
        .where(inArray(responses.itemId, ids))
    : [];
  const existingById = new Map(existing.map((e) => [e.itemId, e]));

  let inserted = 0;
  let unchanged = 0;
  await db.transaction(async (tx) => {
    for (const it of selected) {
      const prior = existingById.get(it.item_id);
      if (prior) {
        const priorResp = new Map(existingResp.filter((r) => r.itemId === it.item_id).map((r) => [r.responseId, r.text]));
        const same =
          prior.questionText === it.question_text &&
          prior.sampleIndex === it.sample_index &&
          priorResp.size === it.responses.length &&
          it.responses.every((r) => priorResp.get(r.response_id) === r.response_text);
        if (!same) throw new Error(`${it.item_id} already imported with different content; refusing to modify it`);
        unchanged++;
        continue;
      }
      await tx.insert(items).values({
        itemId: it.item_id,
        study: studyOf(it),
        sourceQuestionId: it.source_question_id,
        sourceDataset: it.source_dataset,
        itemType: it.item_type,
        specialty: it.specialty,
        questionText: it.question_text,
        context: null,
        turnCount: it.turn_count ?? null,
        sampleIndex: it.sample_index,
        provenance: it.provenance,
      });
      await tx.insert(responses).values(
        it.responses.map((r) => ({
          responseId: r.response_id,
          itemId: it.item_id,
          contentFormat: r.transcript ? ("transcript" as const) : ("markdown" as const),
          responseText: r.response_text,
          transcript: r.transcript ?? null,
        })),
      );
      await tx.insert(responseProvenance).values(
        it.responses.map((r) => ({
          responseId: r.response_id,
          generatorModel: r.provenance.generator_model,
          generatorFamily: r.provenance.generator_family,
          generationId: r.provenance.generation_id,
          generationKey: r.provenance.generation_key,
          runId: r.provenance.run_id,
          experimentId: r.provenance.experiment_id,
          responseTextSha256: r.provenance.response_text_sha256,
          metadata: r.provenance.metadata,
        })),
      );
      await tx.insert(llmJudgments).values(
        it.llm_judgments.map((j) => ({
          judgmentId: j.judgment_id,
          itemId: it.item_id,
          responseId: j.response_id,
          judgingCondition: j.judging_condition,
          experimentId: j.experiment_id,
          judgeModel: j.judge_model,
          judgeFamily: j.judge_family,
          generatorModel: j.generator_model,
          judgePresentationLabel: j.judge_presentation_label,
          originalRank: j.original_rank,
          accuracy: j.scores.accuracy,
          clinicalUtility: j.scores.clinical_utility,
          sourceQuality: j.scores.source_quality,
          verifiability: j.scores.verifiability,
          completeness: j.scores.completeness,
        })),
      );
      inserted++;
    }
  });
  return { inserted, unchanged };
}
