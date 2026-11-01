"use client";

import { useId, useState } from "react";
import type { ResponseEvaluation } from "@/lib/evaluation";
import { scoreSum } from "@/lib/evaluation";
import {
  ERROR_CATEGORIES,
  SCORE_VALUES,
  type Criterion,
  type CriterionKey,
  type ErrorCategory,
  type ErrorFlag,
  type InstrumentConfig,
} from "@/lib/rubric";
import type { PhysicianResponse } from "@/server/evaluations";
import { Markdown } from "./Markdown";
import { cx, Pill, SectionLabel } from "./ui";

interface Props {
  response: PhysicianResponse;
  evaluation: ResponseEvaluation;
  rank: number | null;
  config: InstrumentConfig;
  /** "Response" or "Conversation". */
  noun: string;
  /** Rubric wording for this study. */
  criteria: readonly Criterion[];
  disabled: boolean;
  onChange: (next: ResponseEvaluation) => void;
}

export function ResponseCard({ response, evaluation, rank, config, noun, criteria, disabled, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();
  const sum = scoreSum(evaluation);
  const scored = criteria.filter((c) => evaluation.scores[c.key] != null).length;

  const setScore = (key: CriterionKey, value: number) => {
    const current = evaluation.scores[key];
    // Clicking the selected value again clears it.
    onChange({ ...evaluation, scores: { ...evaluation.scores, [key]: current === value ? null : value } });
  };

  return (
    <section
      id={`response-${response.label}`}
      aria-labelledby={`${bodyId}-title`}
      className="scroll-mt-40 rounded-xl border border-line bg-surface"
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h3 id={`${bodyId}-title`} className="text-[1.05rem] font-semibold">
          {noun} {response.label}
        </h3>
        {rank !== null && <Pill tone="neutral">Ranked #{rank}</Pill>}
        {config.rubricMode !== "off" && (
          <Pill tone={scored === 5 ? "done" : scored ? "progress" : "neutral"}>
            {scored === 5 ? `Score ${sum}/25` : `${scored}/5 scored`}
          </Pill>
        )}
        {evaluation.errorFlag === "yes" && <Pill tone="danger">Error flagged</Pill>}
        <button
          type="button"
          className="ml-auto rounded-md px-2 py-1 text-sm text-muted hover:bg-subtle hover:text-ink"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? `Show ${noun.toLowerCase()}` : "Collapse"}
        </button>
      </header>

      <div id={bodyId} hidden={collapsed} className="px-5 py-4">
        {response.contentFormat === "transcript" && response.transcript ? (
          <Transcript turns={response.transcript} />
        ) : (
          <Markdown text={response.text} />
        )}
      </div>

      {(config.rubricMode !== "off" || config.errorMode !== "off") && (
        <div className="space-y-4 rounded-b-xl border-t border-line bg-subtle px-5 py-4">
          {config.rubricMode !== "off" && (
            <div>
              <SectionLabel className="mb-2">
                Rubric scores · 0 = lowest, 5 = highest{config.rubricMode === "optional" ? " · optional" : ""}
              </SectionLabel>
              <div className="grid gap-y-2">
                {criteria.map((c) => (
                  <ScoreRow
                    key={c.key}
                    label={c.label}
                    question={c.question}
                    value={evaluation.scores[c.key] ?? null}
                    disabled={disabled}
                    onSelect={(v) => setScore(c.key, v)}
                  />
                ))}
              </div>
            </div>
          )}
          {config.errorMode !== "off" && (
            <ErrorAssessment evaluation={evaluation} disabled={disabled} onChange={onChange} label={`${noun} ${response.label}`} />
          )}
        </div>
      )}
    </section>
  );
}

function ScoreRow({
  label,
  question,
  value,
  disabled,
  onSelect,
}: {
  label: string;
  question: string;
  value: number | null;
  disabled: boolean;
  onSelect: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-1 items-center gap-1 md:grid-cols-[minmax(11rem,15rem)_auto]">
      <div id={id} className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="block text-xs text-muted">{question}</span>
      </div>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-1.5">
        {SCORE_VALUES.map((v) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${label}: ${v}`}
              disabled={disabled}
              onClick={() => onSelect(v)}
              className={cx(
                "h-9 w-10 rounded-lg border text-sm font-semibold tabular-nums transition-colors",
                selected
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-white",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FLAG_LABELS: Record<ErrorFlag, string> = { yes: "Yes", no: "No", uncertain: "Uncertain" };

function ErrorAssessment({
  evaluation,
  disabled,
  onChange,
  label,
}: {
  evaluation: ResponseEvaluation;
  disabled: boolean;
  onChange: (next: ResponseEvaluation) => void;
  label: string;
}) {
  const id = useId();
  const toggleCategory = (key: ErrorCategory) => {
    const has = evaluation.errorCategories.includes(key);
    onChange({
      ...evaluation,
      errorCategories: has ? evaluation.errorCategories.filter((k) => k !== key) : [...evaluation.errorCategories, key],
    });
  };
  return (
    <div className="border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={id} className="text-sm font-medium text-ink">
          Clinically significant error?
          <span className="ml-1.5 text-xs font-normal text-muted">optional · separate instrument</span>
        </span>
        <div role="radiogroup" aria-labelledby={id} className="flex gap-1.5">
          {(Object.keys(FLAG_LABELS) as ErrorFlag[]).map((f) => {
            const selected = evaluation.errorFlag === f;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange({ ...evaluation, errorFlag: selected ? null : f })}
                className={cx(
                  "h-8 rounded-lg border px-3 text-sm transition-colors",
                  selected
                    ? f === "yes"
                      ? "border-danger bg-danger text-white"
                      : "border-ink-2 bg-ink-2 text-white"
                    : "border-line bg-surface text-ink-2 hover:border-line-strong",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                {FLAG_LABELS[f]}
              </button>
            );
          })}
        </div>
      </div>
      {evaluation.errorFlag === "yes" && (
        <fieldset className="mt-3 space-y-2" disabled={disabled}>
          <legend className="text-xs text-muted">What kind of error? (select any)</legend>
          <div className="flex flex-wrap gap-1.5">
            {ERROR_CATEGORIES.map((c) => {
              const on = evaluation.errorCategories.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleCategory(c.key)}
                  className={cx(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    on ? "border-danger bg-danger-soft font-medium text-danger" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {evaluation.errorFlag !== null && evaluation.errorFlag !== "no" && (
        <textarea
          aria-label={`Explanation for ${label} (optional)`}
          placeholder="Brief explanation (optional)"
          value={evaluation.errorNote}
          disabled={disabled}
          maxLength={4000}
          onChange={(e) => onChange({ ...evaluation, errorNote: e.target.value })}
          rows={2}
          className="mt-3 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-line-strong"
        />
      )}
    </div>
  );
}

function Transcript({ turns }: { turns: { role: "clinician" | "patient"; content: string }[] }) {
  return (
    <ol className="space-y-3" aria-label="Conversation turns">
      {turns.map((t, i) => (
        <li
          key={i}
          className={cx(
            "rounded-lg border px-4 py-3",
            t.role === "clinician" ? "mr-10 border-line-strong bg-surface" : "ml-10 border-line bg-subtle text-ink-2",
          )}
        >
          <SectionLabel className={cx("mb-1", t.role === "clinician" && "text-accent")}>
            Turn {i + 1} · {t.role === "clinician" ? "Clinician (evaluated)" : "Patient (context)"}
          </SectionLabel>
          <Markdown text={t.content} />
        </li>
      ))}
    </ol>
  );
}
