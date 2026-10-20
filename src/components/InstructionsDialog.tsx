"use client";

import { useEffect, useRef } from "react";
import type { InstrumentConfig } from "@/lib/rubric";
import { InstructionsContent } from "./InstructionsContent";
import { Button } from "./ui";

export function InstructionsDialog({ open, onClose, config }: { open: boolean; onClose: () => void; config: InstrumentConfig }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="instructions-title"
      className="m-auto w-[min(720px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/30"
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 id="instructions-title" className="text-lg font-semibold">
          Instructions
        </h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close instructions">
          ✕
        </Button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
        <InstructionsContent config={config} />
      </div>
      <div className="flex justify-end border-t border-line px-6 py-3">
        <Button variant="primary" onClick={onClose}>
          Back to grading
        </Button>
      </div>
    </dialog>
  );
}
