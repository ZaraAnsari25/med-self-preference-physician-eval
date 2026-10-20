import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { responseIdFor, stratifiedSample, type SourceQuestion } from "@/lib/prep/realPocqi";
import type { StudyBundle } from "@/server/importer";

const fakeQuestions: SourceQuestion[] = Array.from({ length: 90 }, (_, i) => ({
  question_id: `q-${i}`,
  question_text: `[synthetic ${i}]`,
  specialty: ["Alpha", "Beta", "Gamma"][i % 3],
  source_dataset: "fixture",
  source_revision: "x",
  source_file: "x",
  source_row_index: i,
}));

describe("stratified sampling", () => {
  it("is deterministic, proportional and order-independent", () => {
    const a = stratifiedSample(fakeQuestions, 30, "seed");
    const b = stratifiedSample([...fakeQuestions].reverse(), 30, "seed");
    expect(a.map((q) => q.question_id)).toEqual(b.map((q) => q.question_id));
    expect(new Set(a.map((q) => q.question_id)).size).toBe(30);
    for (const s of ["Alpha", "Beta", "Gamma"]) expect(a.filter((q) => q.specialty === s)).toHaveLength(10);
    expect(stratifiedSample(fakeQuestions, 30, "other").map((q) => q.question_id)).not.toEqual(a.map((q) => q.question_id));
  });

  it("derives stable response IDs from generation IDs", () => {
    expect(responseIdFor("gen-1")).toBe(responseIdFor("gen-1"));
    expect(responseIdFor("gen-1")).not.toBe(responseIdFor("gen-2"));
    expect(responseIdFor("gen-1")).toMatch(/^rsp_[0-9a-f]{20}$/);
  });
});

// Runs only after `npm run data:fetch && npm run data:prepare`.
const BUNDLE = "data/prepared/study-bundle.json";
describe.skipIf(!existsSync(BUNDLE))("prepared Real-POCQi bundle", () => {
  const bundle = existsSync(BUNDLE) ? (JSON.parse(readFileSync(BUNDLE, "utf8")) as StudyBundle) : null;
  const manifest = JSON.parse(readFileSync("data/sample-manifest.json", "utf8"));

  it("has 100 questions × 8 responses × 8 judges, all linked by ID", () => {
    const items = bundle!.items;
    expect(items).toHaveLength(100);
    expect(new Set(items.map((i) => i.specialty)).size).toBe(30);
    const allResponseIds = new Set<string>();
    for (const it of items) {
      expect(it.responses).toHaveLength(8);
      expect(new Set(it.responses.map((r) => r.provenance.generator_model)).size).toBe(8);
      expect(it.llm_judgments).toHaveLength(64);
      expect(new Set(it.llm_judgments.map((j) => j.judge_model)).size).toBe(8);
      const ids = new Set(it.responses.map((r) => r.response_id));
      for (const r of it.responses) {
        allResponseIds.add(r.response_id);
        expect(r.response_id).toBe(responseIdFor(r.provenance.generation_id));
        expect(sha256Hex(r.response_text)).toBe(r.provenance.response_text_sha256);
      }
      for (const j of it.llm_judgments) expect(ids.has(j.response_id)).toBe(true);
    }
    expect(allResponseIds.size).toBe(800);
  });

  it("matches the committed sample manifest", () => {
    expect(bundle!.items.map((i) => i.source_question_id)).toEqual(
      manifest.sampled_questions.map((q: { question_id: string }) => q.question_id),
    );
    expect(bundle!.meta.study_seed).toBe(manifest.study_seed);
  });
});
