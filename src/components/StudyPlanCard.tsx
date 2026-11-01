"use client";

import { useState } from "react";
import { STUDIES, type StudyId } from "@/lib/studies";
import type { PlanPreview, PlanStatus } from "@/server/plans";
import { Button, Card, cx, Pill, SectionLabel } from "./ui";

export interface EligibleReviewer {
  userId: string;
  reviewerCode: string;
  username: string;
  specialty: string | null;
  otherStudies: StudyId[];
}

type Run = (fn: () => Promise<string | void>) => Promise<void>;

async function post(body: unknown) {
  const res = await fetch("/api/admin/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  return data;
}

const inputCls = "mt-1 block h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm";

/** The design the study team agreed on; anything else needs an explicit "Change design". */
const AGREED = { calibrationCount: 4, gradersPerCase: 3 };

export function StudyPlanCard({
  study,
  itemCount,
  status,
  eligible,
  defaultSeed,
  run,
}: {
  study: StudyId;
  itemCount: number;
  status: PlanStatus | null;
  eligible: EligibleReviewer[];
  defaultSeed: string;
  run: Run;
}) {
  const def = STUDIES[study];
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-5 py-3">
        <h3 className="font-semibold">{def.name}</h3>
        <span className="text-sm text-muted">{def.task}</span>
        <span className="ml-auto">{status ? <Pill tone="done">Plan applied</Pill> : <Pill>No plan yet</Pill>}</span>
      </div>
      {status ? (
        <AppliedPlan status={status} />
      ) : (
        <PlanForm study={study} itemCount={itemCount} eligible={eligible} defaultSeed={defaultSeed} run={run} />
      )}
    </Card>
  );
}

function PlanForm({
  study,
  itemCount,
  eligible,
  defaultSeed,
  run,
}: {
  study: StudyId;
  itemCount: number;
  eligible: EligibleReviewer[];
  defaultSeed: string;
  run: Run;
}) {
  const def = STUDIES[study];
  const [selected, setSelected] = useState<string[]>([]);
  const [calibrationCount, setCalibration] = useState(AGREED.calibrationCount);
  const [gradersPerCase, setGraders] = useState(AGREED.gradersPerCase);
  const [editing, setEditing] = useState(false);
  const [seed, setSeed] = useState(defaultSeed);
  const isAgreed = calibrationCount === AGREED.calibrationCount && gradersPerCase === AGREED.gradersPerCase && seed === defaultSeed;
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const request = { study, reviewerIds: selected, calibrationCount, gradersPerCase, seed };
  const n = selected.length;
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  const doPreview = async () => {
    setBusy(true);
    try {
      setPreview(await post({ action: "preview", ...request }));
    } catch (e) {
      setPreview({ problems: [e instanceof Error ? e.message : "Preview failed"], plan: null, checks: [], reviewers: {}, blockSpecialties: [], calibrationSpecialties: [] });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-muted">
        Choose the physicians for this study. {calibrationCount} calibration {def.unitNoun}s are graded by every physician. The other{" "}
        {itemCount - calibrationCount} are split into as many blocks as there are physicians (8 physicians → 8 blocks), and{" "}
        <strong className="font-semibold text-ink-2">each physician grades {gradersPerCase} blocks in a row</strong>, so every{" "}
        {def.unitNoun} gets {gradersPerCase} graders.
      </p>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">
          Physicians <span className="font-normal text-muted">({n} selected; only active reviewers with no {def.name} cases are listed)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {eligible.map((r) => (
            <label key={r.userId} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(r.userId)}
                onChange={(e) => change(setSelected)(e.target.checked ? [...selected, r.userId] : selected.filter((x) => x !== r.userId))}
              />
              <span className="font-mono">{r.reviewerCode}</span>
              <span className="text-muted">{r.username}</span>
              {r.specialty && <span className="text-xs text-muted">· {r.specialty}</span>}
              {r.otherStudies.length > 0 && (
                <span className="text-xs text-progress">· in {r.otherStudies.map((o) => STUDIES[o].name).join(", ")}</span>
              )}
            </label>
          ))}
          {eligible.length === 0 && <span className="text-sm text-muted">No eligible reviewers. Create accounts below first.</span>}
        </div>
      </fieldset>
      <div className="rounded-lg border border-line bg-subtle px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">Design:</span>
          <span>
            {calibrationCount} calibration cases · {gradersPerCase} graders per case · seed <code className="font-mono text-xs">{seed}</code>
          </span>
          {isAgreed ? (
            <Pill tone="done">Agreed design</Pill>
          ) : (
            <Pill tone="progress">Differs from the agreed design (4 calibration, 3 graders)</Pill>
          )}
          <span className="ml-auto flex gap-3">
            {!isAgreed && (
              <button
                type="button"
                className="text-sm font-medium text-accent underline underline-offset-2"
                onClick={() => {
                  setCalibration(AGREED.calibrationCount);
                  setGraders(AGREED.gradersPerCase);
                  setSeed(defaultSeed);
                  setPreview(null);
                }}
              >
                Reset to agreed design
              </button>
            )}
            <button type="button" className="text-sm text-ink-2 underline underline-offset-2" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Change design"}
            </button>
          </span>
        </div>
        {editing && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Calibration cases
              <input
                type="number"
                min={0}
                autoComplete="off"
                value={calibrationCount}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => change(setCalibration)(Number(e.target.value))}
                className={inputCls}
              />
            </label>
            <label className="text-sm font-medium">
              Graders per case
              <input
                type="number"
                min={1}
                autoComplete="off"
                value={gradersPerCase}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => change(setGraders)(Number(e.target.value))}
                className={inputCls}
              />
            </label>
            <label className="text-sm font-medium">
              Seed
              <input autoComplete="off" value={seed} onChange={(e) => change(setSeed)(e.target.value)} className={cx(inputCls, "font-mono")} />
            </label>
          </div>
        )}
      </div>
      <PlanStatusLine
        eligibleCount={eligible.length}
        n={n}
        k={gradersPerCase}
        c={calibrationCount}
        itemCount={itemCount}
        noun={def.unitNoun}
      />
      <div className="flex gap-2">
        <Button onClick={doPreview} disabled={busy || n < Math.max(2, gradersPerCase)}>
          Preview plan
        </Button>
        <Button
          variant="primary"
          disabled={busy || !preview?.plan || !preview.checks.every((c) => c.ok)}
          onClick={() =>
            run(async () => {
              const warning = isAgreed
                ? ""
                : `\n\nThis is NOT the agreed design: ${calibrationCount} calibration cases and ${gradersPerCase} graders per case (agreed: 4 and 3).`;
              if (!window.confirm(`Apply this plan? It creates every ${def.name} assignment now and cannot be regenerated.${warning}`)) return "Cancelled";
              const r = await post({ action: "apply", ...request });
              setTimeout(() => window.location.reload(), 1200);
              return `Plan applied: ${r.assignments} assignments created.`;
            })
          }
        >
          Apply plan
        </Button>
        <span className="self-center text-xs text-muted">
          {!preview
            ? "Apply unlocks after a successful preview."
            : !preview.plan || !preview.checks.every((c) => c.ok)
              ? "Fix the problems below, then preview again."
              : "Preview passed. Applying creates every assignment."}
        </span>
      </div>
      {preview && <PreviewView preview={preview} />}
    </div>
  );
}

function PreviewView({ preview }: { preview: PlanPreview }) {
  if (!preview.plan) {
    return (
      <ul role="alert" className="list-disc space-y-1 rounded-lg border border-[#f5c2bd] bg-danger-soft py-3 pr-3 pl-8 text-sm text-danger">
        {preview.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    );
  }
  const { plan } = preview;
  const blocks = plan.blocks.map((_, i) => i + 1);
  const gradersPerBlock = blocks.map((b) => plan.slots.filter((s) => s.blocks.includes(b)).length);
  const hasSpecialty = preview.calibrationSpecialties.some((s) => s !== null);
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm">
        {preview.checks.map((c) => (
          <li key={c.label} className={c.ok ? "text-done" : "text-danger"}>
            {c.ok ? "✓" : "✗"} {c.label}
          </li>
        ))}
      </ul>
      <PlanGrid
        rows={plan.slots.map((s) => ({
          slot: s.slot,
          code: preview.reviewers[s.reviewerId]?.reviewerCode ?? "?",
          username: preview.reviewers[s.reviewerId]?.username ?? "",
          blocks: s.blocks,
          total: s.queue.length,
        }))}
        blocks={blocks}
        calibrationCount={plan.calibrationCount}
        footer={gradersPerBlock}
        calibrationGraders={plan.physicianCount}
      />
      {hasSpecialty && (
        <details className="rounded-lg border border-line px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Specialty mix</summary>
          <p className="mt-2 text-ink-2">
            <span className="font-medium">Calibration:</span> {preview.calibrationSpecialties.join(", ")}
          </p>
          <ul className="mt-2 space-y-1 text-ink-2">
            {preview.blockSpecialties.map((counts, i) => (
              <li key={i}>
                <span className="font-mono font-medium">B{i + 1}</span>{" "}
                {Object.entries(counts)
                  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
                  .map(([s, c]) => `${s} ${c}`)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PlanGrid({
  rows,
  blocks,
  calibrationCount,
  footer,
  calibrationGraders,
  progress,
}: {
  rows: { slot: number; code: string; username: string; blocks: number[]; total: number; done?: number; submitted?: boolean }[];
  blocks: number[];
  calibrationCount: number;
  footer: number[];
  calibrationGraders: number;
  progress?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-subtle text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Position</th>
            <th className="px-3 py-2 text-left font-semibold">Physician</th>
            {blocks.map((b) => (
              <th key={b} className="px-2 py-2 text-center font-semibold">
                B{b}
              </th>
            ))}
            <th className="px-2 py-2 text-center font-semibold">Cal</th>
            <th className="px-3 py-2 text-right font-semibold">{progress ? "Done" : "Cases"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slot} className="border-t border-line">
              <td className="px-3 py-1.5 font-mono font-semibold">P{r.slot}</td>
              <td className="px-3 py-1.5">
                <span className="font-mono">{r.code}</span> <span className="text-muted">{r.username}</span>
              </td>
              {blocks.map((b) => (
                <td key={b} className="px-2 py-1.5 text-center text-done">
                  {r.blocks.includes(b) ? "✓" : ""}
                </td>
              ))}
              <td className="px-2 py-1.5 text-center text-ink-2">{calibrationCount}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {progress ? (
                  <>
                    {r.done}/{r.total} {r.submitted && <Pill tone="done">Submitted</Pill>}
                  </>
                ) : (
                  r.total
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t border-line-strong font-semibold">
            <td className="px-3 py-1.5" colSpan={2}>
              Graders
            </td>
            {footer.map((g, i) => (
              <td key={i} className="px-2 py-1.5 text-center tabular-nums">
                {g}
              </td>
            ))}
            <td className="px-2 py-1.5 text-center tabular-nums">{calibrationGraders}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AppliedPlan({ status }: { status: PlanStatus }) {
  const blocks = status.blocks.map((b) => b.block);
  return (
    <div className="space-y-5 p-5">
      <p className="text-sm text-ink-2">
        {status.physicianCount} physicians · {status.calibrationCount} calibration cases · {status.blocks.length} blocks of {status.blockSize} ·{" "}
        {status.gradersPerCase} graders per case · seed <code className="font-mono text-xs">{status.seed}</code> · applied{" "}
        {new Date(status.appliedAt).toLocaleDateString()}
      </p>

      <PlanGrid
        progress
        rows={status.slots.map((s) => ({ slot: s.slot, code: s.reviewerCode, username: s.username, blocks: s.blocks, total: s.total, done: s.complete, submitted: s.submitted }))}
        blocks={blocks}
        calibrationCount={status.calibrationCount}
        footer={status.blocks.map(() => status.gradersPerCase)}
        calibrationGraders={status.physicianCount}
      />

      <div>
        <SectionLabel className="mb-2">Progress by block</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...status.blocks.map((b) => ({ ...b, name: `B${b.block}` })), { ...status.calibration, name: "Calibration" }].map((b) => (
            <div key={b.name} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{b.name}</span>
                <span className="tabular-nums text-ink-2">
                  {b.casesDone}/{b.cases} cases fully graded
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${b.name} gradings`} aria-valuemin={0} aria-valuemax={b.total} aria-valuenow={b.complete}>
                <div className="h-full bg-done" style={{ width: b.total ? `${(b.complete / b.total) * 100}%` : 0 }} />
              </div>
              <div className="mt-1 text-xs text-muted tabular-nums">
                {b.complete}/{b.total} gradings
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

const AGREED_PHYSICIANS = 8;

/** One plain-language line saying whether the ticked physicians can make a plan, and why not. */
function PlanStatusLine({ eligibleCount, n, k, c, itemCount, noun }: { eligibleCount: number; n: number; k: number; c: number; itemCount: number; noun: string }) {
  const rest = itemCount - c;
  let tone: "muted" | "ok" | "warn" = "warn";
  let text: string;
  if (eligibleCount === 0) {
    tone = "muted";
    text = `Create this study's physician accounts (Add reviewer, below), reload, then tick them here. The agreed design uses ${AGREED_PHYSICIANS}.`;
  } else if (n === 0) {
    tone = "muted";
    text = `Tick this study's physicians above. The agreed design uses ${AGREED_PHYSICIANS}.`;
  } else if (n < k) {
    text = `${n} ticked. Each ${noun} needs ${k} graders, so a plan needs at least ${k} physicians; the agreed design uses ${AGREED_PHYSICIANS}. Create and tick more physicians.`;
  } else if (rest % n !== 0) {
    text = `${n} ticked. The ${rest} non-calibration ${noun}s do not split evenly into ${n} blocks, so this number of physicians does not work with ${c} calibration ${noun}s. The agreed design uses ${AGREED_PHYSICIANS}.`;
  } else {
    tone = n === AGREED_PHYSICIANS ? "ok" : "warn";
    text =
      `${n} ticked: ${c} calibration + ${rest} in ${n} blocks of ${rest / n} → ${c + k * (rest / n)} ${noun}s per physician.` +
      (n === AGREED_PHYSICIANS ? " Ready to preview." : ` This works, but the agreed design uses ${AGREED_PHYSICIANS}.`);
  }
  return (
    <p className={cx("text-sm", tone === "muted" ? "text-muted" : tone === "ok" ? "text-done" : "text-progress")} aria-live="polite">
      {text}
    </p>
  );
}
