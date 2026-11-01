import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { users } from "@/db/schema";
import { buildMedspItem, renderTranscript, type SourceConversation, type SourceScenario } from "@/lib/prep/medsp1000";
import type { SourceJudgment } from "@/lib/prep/realPocqi";
import { assignItems, itemCounts, reviewerProgress, validateStudyData } from "@/server/admin";
import { userForToken, login } from "@/server/auth";
import {
  acknowledgeInstructions,
  listQueue,
  loadEvaluation,
  reopenSubmission,
  reviewerStudies,
  saveEvaluation,
  submitAll,
} from "@/server/evaluations";
import { buildExport } from "@/server/exports";
import { importBundle } from "@/server/importer";
import { getStudySeed } from "@/server/settings";
import { completeState, FIXTURE_PRIVATE_CONTEXT, fixtureBundle, freshDb, makeReviewer, MODELS } from "./helpers";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await freshDb());
  await importBundle(db, fixtureBundle(3, "real_pocqi"));
  await importBundle(db, fixtureBundle(2, "medsp1000"));
});
afterEach(async () => close());

describe("two studies", () => {
  it("imports each study with its own seed and validates both", async () => {
    expect(await itemCounts(db)).toEqual({ real_pocqi: 3, medsp1000: 2 });
    expect(await getStudySeed(db, "real_pocqi")).toBe("test-seed-real_pocqi");
    expect(await getStudySeed(db, "medsp1000")).toBe("test-seed-medsp1000");
    expect((await validateStudyData(db)).ok).toBe(true);
  });

  it("keeps queues, positions and submission separate per study", async () => {
    const both = await makeReviewer(db, "both-studies");
    await assignItems(db, both.userId, { study: "real_pocqi", count: 3 });
    await assignItems(db, both.userId, { study: "medsp1000", count: 2 });
    expect(await listQueue(db, both.userId, "real_pocqi")).toHaveLength(3);
    expect(await listQueue(db, both.userId, "medsp1000")).toHaveLength(2);

    // Position 1 means a different item in each study.
    const p = await loadEvaluation(db, both.userId, "real_pocqi", 1);
    const m = await loadEvaluation(db, both.userId, "medsp1000", 1);
    expect(p.item.itemType).toBe("single_turn");
    expect(m.item.itemType).toBe("multi_turn");
    expect(m.item.turnCount).toBe(8);

    for (const pos of [1, 2, 3]) await saveEvaluation(db, both.userId, "real_pocqi", pos, { state: completeState(), baseRevision: 0 });
    await submitAll(db, both.userId, "real_pocqi");
    // Submitting Real-POCQi locks only Real-POCQi.
    expect((await loadEvaluation(db, both.userId, "real_pocqi", 1)).locked).toBe(true);
    expect((await loadEvaluation(db, both.userId, "medsp1000", 1)).locked).toBe(false);
    await expect(saveEvaluation(db, both.userId, "medsp1000", 1, { state: completeState(), baseRevision: 0 })).resolves.toMatchObject({
      status: "complete",
    });
    const studies = await reviewerStudies(db, both.userId);
    expect(studies.map((s) => [s.study, s.submittedAt !== null])).toEqual([
      ["real_pocqi", true],
      ["medsp1000", false],
    ]);

    const progress = (await reviewerProgress(db)).find((r) => r.userId === both.userId)!;
    expect(progress.studies.map((s) => [s.study, s.complete, s.assigned, s.submittedAt !== null])).toEqual([
      ["real_pocqi", 3, 3, true],
      ["medsp1000", 1, 2, false],
    ]);

    await reopenSubmission(db, both.userId, "real_pocqi");
    expect((await loadEvaluation(db, both.userId, "real_pocqi", 1)).locked).toBe(false);
  });

  it("acknowledges instructions per study", async () => {
    const r = await makeReviewer(db, "ack-test");
    await acknowledgeInstructions(db, r.userId, "medsp1000");
    await acknowledgeInstructions(db, r.userId, "medsp1000"); // idempotent
    const [row] = await db.select().from(users).where(eq(users.userId, r.userId));
    expect(Object.keys(row.instructionsAck)).toEqual(["medsp1000"]);
    const session = await login(db, "ack-test", "correct-horse-battery");
    expect((await userForToken(db, session!.token))!.instructionsAck.medsp1000).toBeTruthy();
  });

  it("only assigns items from the requested study", async () => {
    const r = await makeReviewer(db, "sp-only");
    expect((await assignItems(db, r.userId, { study: "medsp1000", count: 10 })).assigned).toBe(2);
    expect(await listQueue(db, r.userId, "real_pocqi")).toEqual([]);
  });
});

describe("MedSP1000 physician payload", () => {
  it("shows role-labelled turns with no model identity", async () => {
    const r = await makeReviewer(db, "sp-reviewer");
    await assignItems(db, r.userId, { study: "medsp1000", count: 2 });
    const payload = await loadEvaluation(db, r.userId, "medsp1000", 1);
    expect(payload.study).toBe("medsp1000");
    expect(payload.responses).toHaveLength(8);
    for (const resp of payload.responses) {
      expect(resp.contentFormat).toBe("transcript");
      expect(resp.transcript).toHaveLength(8);
      expect(resp.transcript!.map((t) => t.role)).toEqual(["clinician", "patient", "clinician", "patient", "clinician", "patient", "clinician", "patient"]);
      for (const t of resp.transcript!) expect(Object.keys(t).sort()).toEqual(["content", "role"]);
    }
    const json = JSON.stringify(payload);
    for (const [model, fam] of MODELS) {
      expect(json).not.toContain(model);
      expect(json).not.toContain(`"${fam}"`);
    }
    for (const forbidden of ["rsp_", "gen-fixture", "judgment-", "generator", "judge"]) expect(json).not.toContain(forbidden);
  });

  it("exports carry the study and turn count and join to the 8-turn judgments", async () => {
    const r = await makeReviewer(db, "sp-reviewer");
    await assignItems(db, r.userId, { study: "medsp1000", count: 1 });
    await saveEvaluation(db, r.userId, "medsp1000", 1, { state: completeState(), baseRevision: 0 });
    const rows = await buildExport(db, "analysis");
    expect(rows).toHaveLength(64);
    expect(new Set(rows.map((x) => x.study))).toEqual(new Set(["medsp1000"]));
    expect(new Set(rows.map((x) => x.turn_count))).toEqual(new Set([8]));
    expect(rows.filter((x) => x.llm_self_judge)).toHaveLength(8);
  });
});

describe("MedSP1000 preparation", () => {
  const scenario: SourceScenario = {
    question_id: "scen-1",
    question_text: "[synthetic clinician case]",
    private_patient_context: FIXTURE_PRIVATE_CONTEXT,
    source_dataset: "fixture",
    source_revision: "x",
    source_scenario_path: "fixture/scenario1",
    question_text_sha256: "x",
  };
  const conversation = (k: number, model: string): SourceConversation => {
    const turns = Array.from({ length: 8 }, (_, t) => ({
      turn_index: t + 1,
      role: t % 2 === 0 ? "clinician" : "patient",
      content: `[synthetic turn ${t + 1} by ${k}]`,
    }));
    return {
      generation_id: `gen-${k}`,
      generation_key: `key-${k}`,
      experiment_id: "medsp1000-multiturn-generation-v1",
      run_id: "run",
      status: "succeeded",
      question_id: "scen-1",
      question_text: scenario.question_text,
      clinician_model: model,
      patient_model: "patient-sim",
      prompt_version: "v",
      exchange_count: 4,
      turn_count: 8,
      turns,
      transcript_text: renderTranscript(turns),
      attempt: 1,
      created_at: "2026-08-26T00:00:00Z",
    };
  };
  const conversations = MODELS.map(([model], k) => conversation(k, model));
  const judgments: SourceJudgment[] = MODELS.map(([judge, fam], j) => ({
    experiment_id: "medsp1000_all_eight_judges_v2",
    judgment_id: `judgment-${j}`,
    status: "succeeded",
    judging_case: "rubric_and_model_ranking",
    question_id: "scen-1",
    question_text: scenario.question_text,
    specialty: "",
    judge_family: fam,
    judge_model: judge,
    prompt_template_id: "medsp1000_rubric_and_model_ranking_v1",
    seed: 42,
    candidates: conversations.map((c, k) => ({
      response_id: `response-${k + 1}`,
      generation_id: c.generation_id,
      generator_family: MODELS[k][1],
      generator_model: c.clinician_model,
    })),
    result: {
      scored_responses: conversations.map((_, k) => ({
        response_id: `response-${k + 1}`,
        scores: { accuracy: 4, clinical_utility: 4, source_quality: 3, verifiability: 3, completeness: 4 },
      })),
      model_ranking: { response_ids: conversations.map((_, k) => `response-${8 - k}`) },
    },
  }));

  it("builds an 8-turn item that never contains the patient-only script", () => {
    const item = buildMedspItem({
      scenario,
      sampleIndex: 0,
      judgments,
      conversationsById: new Map(conversations.map((c) => [c.generation_id, c])),
    });
    expect(item.item_id).toBe("medsp_scen-1__t8");
    expect(item.responses).toHaveLength(8);
    expect(item.llm_judgments).toHaveLength(64);
    expect(item.responses[0].transcript).toHaveLength(8);
    expect(JSON.stringify(item)).not.toContain(FIXTURE_PRIVATE_CONTEXT);
  });

  it("rejects a conversation whose turns differ from what the judges saw", () => {
    const tampered = conversations.map((c, k) => (k === 0 ? { ...c, transcript_text: c.transcript_text + " extra" } : c));
    expect(() =>
      buildMedspItem({ scenario, sampleIndex: 0, judgments, conversationsById: new Map(tampered.map((c) => [c.generation_id, c])) }),
    ).toThrow(/do not match transcript_text/);
  });
});
