// Clone the original research repository at a pinned commit into ./.source and
// materialise the Git LFS files the app needs, verifying each against the
// sha256 recorded in its LFS pointer. Does not require git-lfs.
//
//   npm run data:fetch            # files needed for Real-POCQi
//   npm run data:fetch -- --all   # every LFS judgment file (incl. MedSP1000)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { SOURCE_COMMIT, SOURCE_REPO } from "../src/lib/prep/source";

const DEST = path.resolve(".source/Medical-LLM-Self-Preference");

const REQUIRED_LFS = ["data/real_pcoqi/judgements/rubric_and_model_ranking.jsonl"];
const OPTIONAL_LFS = [
  "data/real_pcoqi/judgements/direct_ranking.jsonl",
  "data/real_pcoqi/judgements/identity_revealed_rubric_and_model_ranking.jsonl",
  "data/real_pcoqi/judgements/score_only.jsonl",
  "data/outputs/medsp1000/judgements/rubric_and_model_ranking.jsonl",
  "data/outputs/medsp1000/judgements/rubric_and_model_ranking_2_turns.jsonl",
  "data/outputs/medsp1000/judgements/rubric_and_model_ranking_4_turns.jsonl",
  "data/outputs/medsp1000/judgements/rubric_and_model_ranking_6_turns.jsonl",
];

function git(args: string[], cwd?: string) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
}

async function fileSha256(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function parsePointer(text: string) {
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) return null;
  const oid = /oid sha256:([0-9a-f]{64})/.exec(text)?.[1];
  const size = /size (\d+)/.exec(text)?.[1];
  return oid && size ? { oid, size: Number(size) } : null;
}

async function main() {
  const all = process.argv.includes("--all");
  if (!existsSync(DEST)) {
    console.log(`Cloning ${SOURCE_REPO} into ${DEST}`);
    git(["clone", "--quiet", "--no-checkout", `https://github.com/${SOURCE_REPO}.git`, DEST], undefined);
  }
  // Never let a local git-lfs smudge filter interfere; we fetch LFS objects ourselves.
  execFileSync("git", ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false", "checkout", "--quiet", SOURCE_COMMIT], {
    cwd: DEST,
    stdio: "inherit",
  });
  const head = git(["rev-parse", "HEAD"], DEST);
  if (head !== SOURCE_COMMIT) throw new Error(`checked out ${head}, expected ${SOURCE_COMMIT}`);
  console.log(`Source repository at ${head}`);

  for (const rel of [...REQUIRED_LFS, ...(all ? OPTIONAL_LFS : [])]) {
    const pointerText = git(["show", `${SOURCE_COMMIT}:${rel}`], DEST);
    const pointer = parsePointer(pointerText);
    if (!pointer) throw new Error(`${rel} is not an LFS pointer at ${SOURCE_COMMIT}`);
    const target = path.join(DEST, rel);
    if (existsSync(target) && !parsePointer(readFileSync(target, "utf8").slice(0, 200)) && (await fileSha256(target)) === pointer.oid) {
      console.log(`  ok (cached) ${rel}`);
      continue;
    }
    const url = `https://media.githubusercontent.com/media/${SOURCE_REPO}/${SOURCE_COMMIT}/${rel}`;
    console.log(`  downloading ${rel} (${(pointer.size / 1e6).toFixed(1)} MB)`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`download failed for ${rel}: HTTP ${res.status}`);
    const tmp = `${target}.download`;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    const got = await fileSha256(tmp);
    if (got !== pointer.oid) throw new Error(`sha256 mismatch for ${rel}: got ${got}, expected ${pointer.oid}`);
    renameSync(tmp, target);
    console.log(`  ok ${rel} sha256=${got}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
