"use client";

import { useState } from "react";
import { Button } from "./ui";

export function BeginButton({ study, label }: { study: string; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="lg"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/studies/${study}/instructions`, { method: "POST" });
        window.location.href = `/study/${study}`;
      }}
    >
      {label} →
    </Button>
  );
}
