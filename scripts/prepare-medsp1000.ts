// Build the MedSP1000 study bundle (8 visible turns) from the pinned research checkout.
//
//   npm run data:prepare                         # runs this after the Real-POCQi step
//   npx tsx scripts/prepare-medsp1000.ts -- --size 100 --seed pe-medsp1000-v1
//
// Outputs
//   data/prepared/medsp1000-bundle.json   (gitignored: contains the protected model mapping)
//   data/medsp1000-sample-manifest.json   (committed: sampled scenario IDs, seed, source hashes)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildMedspItem,
  MEDSP_DATASET,
  MEDSP_JUDGING_EXPERIMENT,
  MEDSP_TURN_COUNT,
  sampleScenarios,
  selectMedspJudgments,
  type SourceConversation,
  type SourceScenario,
} from "../src/lib/prep/medsp1000";
import type { SourceJudgment } from "../src/lib/prep/realPocqi";
import { SOURCE_COMMIT, SOURCE_REPO } from "../src/lib/prep/source";

const SOURCE = path.resolve(".source/Medical-LLM-Self-Preference");
const FILES = {
  scenarios: "data/question_sets/medsp1000_generation_cases.jsonl",
  conversations: "data/outputs/medsp1000/generations.jsonl",
  judgments: "data/outputs/medsp1000/judgements/rubric_and_model_ranking.jsonl",
};

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJsonl<T>(rel: string): { rows: T[]; sha256: string } {
  const buf = readFileSync(path.join(SOURCE, rel));
  const text = buf.toString("utf8");
  if (text.startsWith("version https://git-lfs")) throw new Error(`${rel} is an LFS pointer; run npm run data:fetch`);
  return {
    rows: text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T),
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

function main() {
  const seed = arg("seed", "pe-medsp1000-v1");
  const size = Number(arg("size", "100"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: SOURCE }).toString().trim();
  if (head !== SOURCE_COMMIT) throw new Error(`source checkout at ${head}, expected ${SOURCE_COMMIT}; run npm run data:fetch`);

  const scenarios = readJsonl<SourceScenario>(FILES.scenarios);
  const conversations = readJsonl<SourceConversation>(FILES.conversations);
  const judgments = readJsonl<SourceJudgment>(FILES.judgments);

  const conversationsById = new Map(conversations.rows.map((c) => [c.generation_id, c]));
  if (conversationsById.size !== conversations.rows.length) throw new Error("duplicate conversation IDs");
  const judgmentsByScenario = selectMedspJudgments(judgments.rows);

  // Validate every scenario before sampling.
  const built = new Map(
    scenarios.rows.map((s) => [
      s.question_id,
      buildMedspItem({ scenario: s, sampleIndex: -1, judgments: judgmentsByScenario.get(s.question_id) ?? [], conversationsById }),
    ]),
  );
  console.log(`Validated ${built.size} MedSP1000 scenarios × 8 conversations × 8 judges (${MEDSP_TURN_COUNT} turns)`);

  const items = sampleScenarios([...built.keys()], size, seed).map((id, i) => ({ ...built.get(id)!, sample_index: i }));

  // The bundle must never carry the patient-only script.
  const serialized = JSON.stringify(items);
  for (const s of scenarios.rows) {
    if (s.private_patient_context.length > 40 && serialized.includes(s.private_patient_context)) {
      throw new Error(`private patient context for ${s.question_id} leaked into the bundle`);
    }
  }

  const meta = {
    bundle_version: "1",
    study: "medsp1000",
    study_seed: seed,
    sample_size: size,
    visible_turns: MEDSP_TURN_COUNT,
    sampling: "simple random sample: hashSort of validated scenario IDs with `${seed}:order`, first N",
    source_repository: SOURCE_REPO,
    source_commit: SOURCE_COMMIT,
    source_dataset: MEDSP_DATASET,
    source_files: {
      scenarios: { path: FILES.scenarios, sha256: scenarios.sha256 },
      conversations: { path: FILES.conversations, sha256: conversations.sha256 },
      judgments: { path: FILES.judgments, sha256: judgments.sha256 },
    },
    judging_experiment_id: MEDSP_JUDGING_EXPERIMENT,
    judging_condition: "rubric_and_model_ranking (full 8-turn trajectory)",
    judgment_selection: "status=succeeded, experiment_id=medsp1000_all_eight_judges_v2, last row per (question_id, judge_model) in file order",
    shown_to_physicians: "question_text (clinician initialization) and transcript turns; private_patient_context excluded",
  };

  mkdirSync("data/prepared", { recursive: true });
  writeFileSync("data/prepared/medsp1000-bundle.json", JSON.stringify({ meta, items }, null, 1) + "\n");
  writeFileSync(
    "data/medsp1000-sample-manifest.json",
    JSON.stringify(
      {
        ...meta,
        sampled_scenarios: items.map((it) => ({
          sample_index: it.sample_index,
          question_id: it.source_question_id,
          source_scenario_path: it.provenance.source_scenario_path,
          question_text_sha256: it.provenance.question_text_sha256,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote data/prepared/medsp1000-bundle.json (${items.length} scenarios) and data/medsp1000-sample-manifest.json`);
}

main();
