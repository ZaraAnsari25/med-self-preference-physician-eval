"use client";

import type { QueueEntry } from "@/server/evaluations";
import { cx } from "./ui";

const STATUS_TEXT = { complete: "completed", in_progress: "in progress", not_started: "not started" } as const;

export function QuestionNav({
  queue,
  current,
  onSelect,
  onSubmit,
}: {
  queue: QueueEntry[];
  current: number;
  onSelect: (position: number) => void;
  onSubmit: () => void;
}) {
  return (
    <nav aria-label="Questions" className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {queue.map((q) => {
          const isCurrent = q.position === current;
          return (
            <button
              key={q.position}
              type="button"
              onClick={() => onSelect(q.position)}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={`Question ${q.position}, ${STATUS_TEXT[q.status]}`}
              title={`Question ${q.position} · ${STATUS_TEXT[q.status]}`}
              className={cx(
                "h-8 min-w-9 rounded-md border px-1.5 font-mono text-[0.8rem] tabular-nums transition-colors",
                isCurrent
                  ? "border-accent bg-accent font-semibold text-white"
                  : q.status === "complete"
                    ? "border-done-line bg-done-soft text-done hover:border-done"
                    : q.status === "in_progress"
                      ? "border-progress-line bg-progress-soft text-progress hover:border-progress"
                      : "border-line bg-surface text-ink-2 hover:border-line-strong",
              )}
            >
              {q.position}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onSubmit}
          className="ml-1 h-8 rounded-md border border-line px-3 text-[0.8rem] font-medium text-ink-2 hover:border-line-strong"
        >
          Review &amp; submit
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
        <Legend cls="border-line bg-surface" text="Not started" />
        <Legend cls="border-progress-line bg-progress-soft" text="In progress" />
        <Legend cls="border-done-line bg-done-soft" text="Completed" />
        <Legend cls="border-accent bg-accent" text="Current" />
      </div>
    </nav>
  );
}

function Legend({ cls, text }: { cls: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("h-3 w-3 rounded-sm border", cls)} />
      {text}
    </span>
  );
}
