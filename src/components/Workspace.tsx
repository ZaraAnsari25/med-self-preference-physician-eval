"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { completionProblems, type EvaluationState, type ResponseEvaluation } from "@/lib/evaluation";
import type { PhysicianItemPayload, QueueEntry } from "@/server/evaluations";
import { InstructionsDialog } from "./InstructionsDialog";
import { LogoutButton } from "./LogoutButton";
import { QuestionNav } from "./QuestionNav";
import { RankingPanel } from "./RankingPanel";
import { ResponseCard } from "./ResponseCard";
import { Button, Card, cx, Logo, Pill, SectionLabel } from "./ui";

type SaveStatus = "saved" | "unsaved" | "saving" | "error";
const AUTOSAVE_DELAY_MS = 700;

interface Props {
  payload: PhysicianItemPayload;
  queue: QueueEntry[];
  reviewerCode: string;
  displayName: string | null;
}

function previewOf(text: string) {
  return text
    .replace(/[#*_`>|[\]()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

export function Workspace({ payload, queue: initialQueue, reviewerCode, displayName }: Props) {
  const router = useRouter();
  const { position, total, item, responses, config, locked } = payload;
  const labels = useMemo(() => responses.map((r) => r.label), [responses]);
  const previews = useMemo(
    () => Object.fromEntries(responses.map((r) => [r.label, previewOf(r.transcript?.map((t) => t.content).join(" ") ?? r.text)])),
    [responses],
  );

  const [state, setState] = useState<EvaluationState>(payload.state);
  const [queue, setQueue] = useState(initialQueue);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const stateRef = useRef(state);
  const revisionRef = useRef(payload.revision);
  const dirtyRef = useRef(false);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveOkRef = useRef(true);

  // Active (visible) time on this question, sent with each save.
  const activeMsRef = useRef(0);
  const visibleSinceRef = useRef<number | null>(null);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") visibleSinceRef.current = Date.now();
      else if (visibleSinceRef.current !== null) {
        activeMsRef.current += Date.now() - visibleSinceRef.current;
        visibleSinceRef.current = null;
      }
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const takeActiveMs = () => {
    const now = Date.now();
    let ms = activeMsRef.current;
    if (visibleSinceRef.current !== null) {
      ms += now - visibleSinceRef.current;
      visibleSinceRef.current = now;
    }
    activeMsRef.current = 0;
    return ms;
  };

  const doSave = useCallback(async (): Promise<boolean> => {
    const activeMsDelta = takeActiveMs();
    try {
      const res = await fetch(`/api/evaluations/${position}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, baseRevision: revisionRef.current, activeMsDelta }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (HTTP ${res.status})`);
      revisionRef.current = body.revision;
      setQueue((q) => q.map((e) => (e.position === position ? { ...e, status: body.status } : e)));
      setSaveError(null);
      return true;
    } catch (err) {
      activeMsRef.current += activeMsDelta;
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }
  }, [position]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (inflightRef.current) await inflightRef.current;
    if (!dirtyRef.current) return lastSaveOkRef.current;
    dirtyRef.current = false;
    setSaveStatus("saving");
    const p = doSave();
    inflightRef.current = p;
    const ok = await p;
    inflightRef.current = null;
    lastSaveOkRef.current = ok;
    if (!ok) {
      dirtyRef.current = true;
      setSaveStatus("error");
      return false;
    }
    if (dirtyRef.current) return flush();
    setSaveStatus("saved");
    return true;
  }, [doSave]);

  const update = useCallback(
    (fn: (s: EvaluationState) => EvaluationState) => {
      if (locked) return;
      setState((prev) => {
        const next = fn(prev);
        stateRef.current = next;
        return next;
      });
      dirtyRef.current = true;
      setSaveStatus((s) => (s === "error" ? "error" : "unsaved"));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush, locked],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || inflightRef.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flush]);

  const navigate = async (href: string) => {
    const ok = locked ? true : await flush();
    if (!ok && !window.confirm("Your latest changes could not be saved. Leave this question anyway?")) return;
    router.push(href);
    router.refresh();
  };
  const goTo = (p: number) => navigate(`/evaluate/${p}`);

  const setResponse = (label: string, next: ResponseEvaluation) =>
    update((s) => ({ ...s, responses: { ...s.responses, [label]: next } }));
  const reorder = (next: string[]) => update((s) => ({ ...s, ranking: next, rankingConfirmed: false, rankingModified: true }));
  const confirmRanking = () => update((s) => ({ ...s, ranking: s.ranking ?? labels, rankingConfirmed: true }));
  const jumpTo = (label: string) => {
    const el = document.getElementById(`response-${label}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector("h3")?.setAttribute("tabindex", "-1");
    (el?.querySelector("h3") as HTMLElement | null)?.focus({ preventScroll: true });
  };

  const problems = completionProblems(labels, state, config);
  const completed = queue.filter((q) => q.status === "complete").length;
  const isLast = position === total;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="font-semibold">Medical LLM Physician Evaluation</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-muted">
              Reviewer: <span className="font-semibold text-ink">{displayName ?? reviewerCode}</span>
            </span>
            <SaveIndicator status={locked ? "locked" : saveStatus} onRetry={() => void flush()} />
            <div className="flex items-center gap-2.5">
              <span className="whitespace-nowrap text-ink-2">
                {completed} of {total} questions completed
              </span>
              <div
                className="h-2 w-32 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-label="Questions completed"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={completed}
              >
                <div className="h-full rounded-full bg-done transition-all" style={{ width: `${(completed / total) * 100}%` }} />
              </div>
            </div>
            <Button onClick={() => setInstructionsOpen(true)}>Instructions</Button>
            <div className="flex gap-1.5">
              <Button aria-label="Previous question" disabled={position === 1} onClick={() => goTo(position - 1)}>
                ←
              </Button>
              <Button aria-label="Next question" disabled={isLast} onClick={() => goTo(position + 1)}>
                →
              </Button>
            </div>
            <LogoutButton beforeLogout={flush} />
          </div>
        </div>
        {saveStatus === "error" && saveError && !locked && (
          <div role="alert" className="border-t border-[#f5c2bd] bg-danger-soft">
            <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-6 py-2 text-sm text-danger">
              <span>
                <strong>Not saved:</strong> {saveError} Your changes are kept on this page.
              </span>
              <Button size="sm" variant="danger" onClick={() => void flush()}>
                Retry save
              </Button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-5">
        <QuestionNav queue={queue} current={position} onSelect={goTo} onSubmit={() => navigate("/submit")} />

        {locked && (
          <div className="mt-4 rounded-xl border border-done-line bg-done-soft px-4 py-3 text-sm text-done">
            Your evaluations have been submitted and are read-only. Contact the study team if you need to make a change.
          </div>
        )}

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <Card>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
                <span className="text-lg font-bold">Q{position}</span>
                <Pill>
                  {position} of {total}
                </Pill>
                {item.specialty && <Pill>Specialty: {item.specialty}</Pill>}
                {item.turnCount !== null && <Pill>{item.turnCount} visible turns</Pill>}
                <span className="ml-auto">
                  <StatusPill status={queue.find((q) => q.position === position)?.status ?? "not_started"} />
                </span>
              </div>
              <div className="p-5">
                <SectionLabel className="mb-2">{item.itemType === "multi_turn" ? "Case information" : "Clinical question"}</SectionLabel>
                <div className="whitespace-pre-wrap rounded-lg border border-question-line bg-question px-5 py-4 text-[1.02rem] leading-relaxed">
                  {item.questionText}
                </div>
              </div>
            </Card>

            <div className="flex items-baseline justify-between pt-1">
              <h2 className="text-lg font-semibold">Responses</h2>
              <p className="text-sm text-muted">Read each response in full. Authors are hidden.</p>
            </div>

            {responses.map((r) => (
              <ResponseCard
                key={r.label}
                response={r}
                evaluation={state.responses[r.label]}
                rank={state.ranking ? state.ranking.indexOf(r.label) + 1 : null}
                config={config}
                disabled={locked}
                onChange={(next) => setResponse(r.label, next)}
              />
            ))}

            <Card className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1 text-sm">
                {problems.length === 0 ? (
                  <span className="font-medium text-done">This question is complete.</span>
                ) : (
                  <>
                    <span className="font-medium text-ink">Still needed for this question:</span>
                    <ul className="mt-1 list-disc pl-5 text-ink-2">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="lg" disabled={position === 1} onClick={() => goTo(position - 1)}>
                  ← Previous
                </Button>
                {isLast ? (
                  <Button size="lg" variant="primary" onClick={() => navigate("/submit")}>
                    Review &amp; submit →
                  </Button>
                ) : (
                  <Button size="lg" variant="primary" onClick={() => goTo(position + 1)}>
                    Save &amp; next question →
                  </Button>
                )}
              </div>
            </Card>
          </div>

          <aside className="lg:order-none -order-1">
            <div className="lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
              <RankingPanel
                labels={labels}
                ranking={state.ranking}
                confirmed={state.rankingConfirmed}
                modified={state.rankingModified}
                previews={previews}
                disabled={locked}
                onReorder={reorder}
                onConfirm={confirmRanking}
                onJump={jumpTo}
              />
            </div>
          </aside>
        </div>
      </main>

      <InstructionsDialog open={instructionsOpen} onClose={() => setInstructionsOpen(false)} config={config} />
    </div>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus | "locked"; onRetry: () => void }) {
  const map = {
    saved: { text: "All changes saved", cls: "bg-done-soft text-done border-done-line" },
    unsaved: { text: "Unsaved changes", cls: "bg-subtle text-ink-2 border-line" },
    saving: { text: "Saving…", cls: "bg-subtle text-ink-2 border-line" },
    error: { text: "Save error", cls: "bg-danger-soft text-danger border-[#f5c2bd]" },
    locked: { text: "Submitted", cls: "bg-done-soft text-done border-done-line" },
  }[status];
  return (
    <span role="status" aria-live="polite" className="flex items-center gap-1.5">
      <span className={cx("rounded-full border px-2.5 py-0.5 text-xs font-medium", map.cls)}>{map.text}</span>
      {status === "error" && (
        <button type="button" onClick={onRetry} className="text-xs font-medium text-danger underline">
          Retry
        </button>
      )}
    </span>
  );
}

export function StatusPill({ status }: { status: QueueEntry["status"] }) {
  if (status === "complete") return <Pill tone="done">Completed</Pill>;
  if (status === "in_progress") return <Pill tone="progress">In progress</Pill>;
  return <Pill>Not started</Pill>;
}
