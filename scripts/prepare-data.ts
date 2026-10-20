// Build the study bundle from the pinned research repository checkout.
//
//   npm run data:prepare                       # 100-question stratified sample
//   npm run data:prepare -- --size 100 --seed pe-real-pocqi-v1
//
// Outputs
//   data/prepared/study-bundle.json  (gitignored: contains the protected model mapping)
//   data/sample-manifest.json        (committed: sampled question IDs, seed, source hashes)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildItem,
  JUDGING_CONDITION,
  PRODUCTION_JUDGING_EXPERIMENT,
  REAL_POCQI_DATASET,
  selectJudgments,
  stratifiedSample,
  type SourceGeneration,
  type SourceJudgment,
  type SourceQuestion,
} from "../src/lib/prep/realPocqi";
import { SOURCE_COMMIT, SOURCE_REPO } from "../src/lib/prep/source";

const SOURCE = path.resolve(".source/Medical-LLM-Self-Preference");
const FILES = {
  questions: "data/question_sets/real_pocqi_questions.jsonl",
  generations: "data/outputs/generations/real_pocqi_generations.jsonl",
  judgments: "data/real_pcoqi/judgements/rubric_and_model_ranking.jsonl",
};

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJsonl<T>(rel: string): { rows: T[]; sha256: string } {
  const buf = readFileSync(path.join(SOURCE, rel));
  const text = buf.toString("utf8");
  if (text.startsWith("version https://git-lfs")) throw new Error(`${rel} is an LFS pointer; run npm run data:fetch`);
  const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
  return { rows, sha256: createHash("sha256").update(buf).digest("hex") };
}

function main() {
  const seed = arg("seed", "pe-real-pocqi-v1");
  const size = Number(arg("size", "100"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: SOURCE }).toString().trim();
  if (head !== SOURCE_COMMIT) throw new Error(`source checkout at ${head}, expected ${SOURCE_COMMIT}`);

  const questions = readJsonl<SourceQuestion>(FILES.questions);
  const generations = readJsonl<SourceGeneration>(FILES.generations);
  const judgments = readJsonl<SourceJudgment>(FILES.judgments);

  const questionIds = new Set(questions.rows.map((q) => q.question_id));
  if (questionIds.size !== questions.rows.length) throw new Error("duplicate question IDs in question set");
  const generationsById = new Map(generations.rows.map((g) => [g.generation_id, g]));
  if (generationsById.size !== generations.rows.length) throw new Error("duplicate generation IDs");
  const judgmentsByQuestion = selectJudgments(judgments.rows);

  // Validate every question, not only the sampled ones, so data problems surface early.
  const built = new Map(
    questions.rows.map((q) => [
      q.question_id,
      buildItem({ question: q, sampleIndex: -1, judgments: judgmentsByQuestion.get(q.question_id) ?? [], generationsById }),
    ]),
  );
  console.log(`Validated ${built.size} questions × 8 responses × 8 judges`);

  const sample = stratifiedSample(questions.rows, size, seed);
  const items = sample.map((q, i) => ({ ...built.get(q.question_id)!, sample_index: i }));

  const meta = {
    bundle_version: "1",
    study_seed: seed,
    sample_size: size,
    sampling: "stratified by specialty; proportional allocation (largest remainder, min 1); hashSort within stratum; hashSort overall order",
    source_repository: SOURCE_REPO,
    source_commit: SOURCE_COMMIT,
    source_dataset: REAL_POCQI_DATASET,
    source_files: Object.fromEntries(
      Object.entries(FILES).map(([k, rel]) => [
        k,
        { path: rel, sha256: { questions, generations, judgments }[k as keyof typeof FILES].sha256 },
      ]),
    ),
    judging_experiment_id: PRODUCTION_JUDGING_EXPERIMENT,
    judging_condition: JUDGING_CONDITION,
    judgment_selection: "status=succeeded, experiment_id=production, last row per (question_id, judge_model) in file order",
  };

  mkdirSync("data/prepared", { recursive: true });
  writeFileSync("data/prepared/study-bundle.json", JSON.stringify({ meta, items }, null, 1) + "\n");

  const allocation: Record<string, number> = {};
  for (const it of items) allocation[it.specialty] = (allocation[it.specialty] ?? 0) + 1;
  const manifest = {
    ...meta,
    allocation_by_specialty: Object.fromEntries(Object.entries(allocation).sort()),
    sampled_questions: items.map((it) => ({
      sample_index: it.sample_index,
      question_id: it.source_question_id,
      specialty: it.specialty,
      question_text_sha256: it.provenance.question_text_sha256,
    })),
  };
  writeFileSync("data/sample-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote data/prepared/study-bundle.json (${items.length} items) and data/sample-manifest.json`);
}

main();
