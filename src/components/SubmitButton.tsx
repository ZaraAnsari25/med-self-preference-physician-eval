"use client";

import { useState } from "react";
import { Button } from "./ui";

export function SubmitButton({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!window.confirm("Submit all evaluations? They will be locked after submission.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/submit", { method: "POST" });
    if (res.ok) {
      window.location.href = "/done";
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Submission failed. Please try again.");
    setBusy(false);
  };
  return (
    <div className="text-right">
      <Button variant="primary" size="lg" disabled={disabled || busy} onClick={submit}>
        {busy ? "Submitting…" : "Submit evaluations"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
