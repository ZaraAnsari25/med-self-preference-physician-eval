// Study plan generator: who grades which cases. Pure and deterministic — the
// same inputs and seed always give the same plan.
//
//   1. Calibration: walk the cases in frozen sample order and take the first
//      `calibrationCount`; when cases carry a specialty, skip any whose
//      specialty is already taken, so calibration cases span distinct specialties.
//   2. Blocks: the remaining cases, grouped by specialty (sample order within a
//      specialty), are dealt one at a time into N blocks, N = number of physicians.
//   3. Slots: physicians are assigned to positions P1..PN by hashSort(seed).
//   4. Rotation: position Pi grades blocks i, i+1, …, i+k-1 (mod N), k = graders
//      per case, so every block case gets exactly k graders.
//   5. Queue: each physician's cases (calibration + blocks) are shuffled by
//      hashSort(seed, physician) so graders reach a case at different points.
import { hashSort } from "./hash";

export interface PlanCase {
  itemId: string;
  sampleIndex: number;
  /** Real-POCQi specialty; null when the study has none (MedSP1000). */
  specialty: string | null;
}

export interface PlanInput {
  cases: readonly PlanCase[];
  reviewerIds: readonly string[];
  calibrationCount: number;
  gradersPerCase: number;
  seed: string;
}

export interface PlanSlot {
  /** 1-based position (P1..PN). */
  slot: number;
  reviewerId: string;
  /** 1-based block numbers this position grades. */
  blocks: number[];
  /** Item IDs in this physician's queue order. */
  queue: string[];
}

export interface StudyPlan {
  physicianCount: number;
  calibrationCount: number;
  gradersPerCase: number;
  blockSize: number;
  seed: string;
  calibration: string[];
  /** blocks[b - 1] = item IDs in block b. */
  blocks: string[][];
  slots: PlanSlot[];
}

export interface PlanCheck {
  ok: boolean;
  label: string;
}

export class PlanError extends Error {}

export function planProblems(input: Omit<PlanInput, "seed" | "reviewerIds"> & { physicianCount: number }): string[] {
  const { cases, physicianCount: n, calibrationCount: c, gradersPerCase: k } = input;
  const problems: string[] = [];
  if (n < 2) problems.push("Choose at least 2 physicians.");
  if (k < 1) problems.push("Graders per case must be at least 1.");
  else if (k > n) problems.push(`Each case needs ${k} graders, but only ${n} physicians are selected. Select at least ${k}.`);
  if (c < 0 || c >= cases.length) problems.push(`Calibration cases must be between 0 and ${cases.length - 1}.`);
  const rest = cases.length - c;
  if (n >= 2 && rest > 0 && rest % n !== 0) {
    problems.push(
      `${cases.length} cases − ${c} calibration = ${rest}, which does not split evenly into ${n} blocks. ` +
        `Change the number of physicians or calibration cases.`,
    );
  }
  if (cases.some((x) => x.specialty !== null)) {
    const specialties = new Set(cases.map((x) => x.specialty));
    if (c > specialties.size) problems.push(`Only ${specialties.size} specialties are available for ${c} calibration cases.`);
  }
  return problems;
}

export function generatePlan(input: PlanInput): StudyPlan {
  const { reviewerIds, calibrationCount: c, gradersPerCase: k, seed } = input;
  const n = reviewerIds.length;
  if (new Set(reviewerIds).size !== n) throw new PlanError("A physician is listed twice.");
  const problems = planProblems({ ...input, physicianCount: n });
  if (problems.length) throw new PlanError(problems.join(" "));

  const ordered = [...input.cases].sort((a, b) => a.sampleIndex - b.sampleIndex);
  const bySpecialty = ordered.some((x) => x.specialty !== null);

  // 1. Calibration.
  const calibration: PlanCase[] = [];
  const usedSpecialties = new Set<string | null>();
  for (const x of ordered) {
    if (calibration.length === c) break;
    if (bySpecialty && usedSpecialties.has(x.specialty)) continue;
    calibration.push(x);
    usedSpecialties.add(x.specialty);
  }
  const calibrationIds = new Set(calibration.map((x) => x.itemId));

  // 2. Deal the rest into n blocks, grouped by specialty when there is one.
  const rest = ordered.filter((x) => !calibrationIds.has(x.itemId));
  const deck = bySpecialty
    ? [...rest].sort((a, b) => (a.specialty! < b.specialty! ? -1 : a.specialty! > b.specialty! ? 1 : a.sampleIndex - b.sampleIndex))
    : rest;
  const blocks: string[][] = Array.from({ length: n }, () => []);
  deck.forEach((x, i) => blocks.at(i % n)!.push(x.itemId));

  // 3–5. Slots, rotation, queues.
  const slotOrder = hashSort(reviewerIds, `${seed}:slots`, (id) => id);
  const slots: PlanSlot[] = slotOrder.map((reviewerId, i) => {
    const blockNumbers = Array.from({ length: k }, (_, j) => ((i + j) % n) + 1);
    const items = [...calibration.map((x) => x.itemId), ...blockNumbers.flatMap((b) => blocks.at(b - 1)!)];
    return { slot: i + 1, reviewerId, blocks: blockNumbers, queue: hashSort(items, `${seed}:queue:${reviewerId}`, (id) => id) };
  });

  return {
    physicianCount: n,
    calibrationCount: c,
    gradersPerCase: k,
    blockSize: (input.cases.length - c) / n,
    seed,
    calibration: calibration.map((x) => x.itemId),
    blocks,
    slots,
  };
}

/** Independent re-count of a plan, shown in the admin preview and asserted in tests. */
export function checkPlan(plan: StudyPlan, totalCases: number): PlanCheck[] {
  const graders = new Map<string, number>();
  for (const s of plan.slots) for (const id of s.queue) graders.set(id, (graders.get(id) ?? 0) + 1);
  const calibration = new Set(plan.calibration);
  const blockCases = [...graders.keys()].filter((id) => !calibration.has(id));
  const perPhysician = plan.calibrationCount + plan.gradersPerCase * plan.blockSize;
  return [
    { ok: graders.size === totalCases, label: `All ${totalCases} cases are assigned` },
    {
      ok: blockCases.length > 0 && blockCases.every((id) => graders.get(id) === plan.gradersPerCase),
      label: `Every block case has exactly ${plan.gradersPerCase} graders`,
    },
    {
      ok: plan.calibration.every((id) => graders.get(id) === plan.physicianCount),
      label: `Every calibration case is graded by all ${plan.physicianCount} physicians`,
    },
    {
      ok: plan.slots.every((s) => s.queue.length === perPhysician && new Set(s.queue).size === s.queue.length),
      label: `Each physician has ${perPhysician} different cases`,
    },
  ];
}

export const slotLabel = (slot: number) => `P${slot}`;
export const blockLabel = (block: number | null) => (block === null ? "calibration" : `B${block}`);
