"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { Button, cx } from "./ui";

interface Props {
  /** "Response" or "Conversation". */
  noun: string;
  labels: string[];
  ranking: string[] | null;
  confirmed: boolean;
  modified: boolean;
  previews: Record<string, string>;
  disabled: boolean;
  onReorder: (next: string[]) => void;
  onConfirm: () => void;
  onJump: (label: string) => void;
}

export function RankingPanel({ noun, labels, ranking, confirmed, modified, previews, disabled, onReorder, onConfirm, onJump }: Props) {
  const [dragging, setDragging] = useState(false);
  const order = ranking ?? labels;
  const unranked = ranking === null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || disabled) return;
    onReorder(arrayMove(order, from, to));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false);
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
  };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">Rank {noun.toLowerCase()}s from best to worst</h2>
        <p className="mt-0.5 text-xs text-muted">1 = best {noun.toLowerCase()} · {order.length} = worst · no ties</p>
      </div>

      <div className="px-3 pt-3">
        {unranked ? (
          <p className="rounded-lg border border-dashed border-line-strong bg-subtle px-3 py-2 text-xs text-ink-2">
            Not ranked yet. The list below is just the display order. Drag entries or use the arrows to set your ranking.
          </p>
        ) : confirmed ? (
          <p className="rounded-lg border border-done-line bg-done-soft px-3 py-2 text-xs font-medium text-done">
            Ranking confirmed. Moving any entry will require you to confirm again.
          </p>
        ) : (
          <p className="rounded-lg border border-progress-line bg-progress-soft px-3 py-2 text-xs text-progress">
            Draft ranking. Confirm it when you are done.
          </p>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5 p-3" aria-label="Ranking, best first">
            {order.map((label, i) => (
              <RankRow
                noun={noun}
                key={label}
                label={label}
                rank={i + 1}
                total={order.length}
                preview={previews[label] ?? ""}
                muted={unranked}
                disabled={disabled}
                onUp={() => move(i, i - 1)}
                onDown={() => move(i, i + 1)}
                onJump={() => onJump(label)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <div className="border-t border-line p-3">
        <Button
          variant={confirmed ? "secondary" : "primary"}
          className="w-full"
          disabled={disabled || confirmed || dragging}
          onClick={onConfirm}
        >
          {confirmed ? "Ranking confirmed ✓" : unranked || !modified ? "Confirm this order as my ranking" : "Confirm ranking"}
        </Button>
        {!confirmed && (unranked || !modified) && (
          <p className="mt-2 text-xs text-muted">
            You have not reordered anything. Only confirm if this order reflects your judgment.
          </p>
        )}
      </div>
    </div>
  );
}

function RankRow({
  noun,
  label,
  rank,
  total,
  preview,
  muted,
  disabled,
  onUp,
  onDown,
  onJump,
}: {
  noun: string;
  label: string;
  rank: number;
  total: number;
  preview: string;
  muted: boolean;
  disabled: boolean;
  onUp: () => void;
  onDown: () => void;
  onJump: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        "flex items-center gap-2 rounded-lg border bg-surface px-2 py-1.5",
        isDragging ? "z-10 border-accent shadow-md" : "border-line",
      )}
    >
      <span
        className={cx(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums",
          muted ? "bg-subtle text-muted" : "bg-accent-soft text-accent",
        )}
        aria-hidden
      >
        {muted ? "–" : rank}
      </span>
      <button
        type="button"
        className={cx("flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-muted active:cursor-grabbing", disabled && "cursor-not-allowed")}
        aria-label={`Drag ${noun} ${label}${muted ? "" : `, currently rank ${rank} of ${total}`}`}
        {...attributes}
        {...listeners}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
          {[2, 8, 14].map((y) => [2, 8].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" />))}
        </svg>
      </button>
      <button type="button" onClick={onJump} className="min-w-0 flex-1 text-left" title="Scroll to this response">
        <div className="text-sm font-semibold">
          {noun} {label}
        </div>
        <div className="truncate text-xs text-muted">{preview}</div>
      </button>
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          onClick={onUp}
          disabled={disabled || rank === 1}
          aria-label={`Move ${noun} ${label} up`}
          className="flex h-5 w-8 items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink disabled:opacity-30"
        >
          <Chevron up />
        </button>
        <button
          type="button"
          onClick={onDown}
          disabled={disabled || rank === total}
          aria-label={`Move ${noun} ${label} down`}
          className="flex h-5 w-8 items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink disabled:opacity-30"
        >
          <Chevron />
        </button>
      </div>
    </li>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className={up ? "rotate-180" : ""}>
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
