"use client";

import { useState } from "react";
import { Button } from "./ui";

export function BeginButton({ disabled, label }: { disabled: boolean; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="lg"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/instructions", { method: "POST" });
        window.location.href = "/evaluate";
      }}
    >
      {label} →
    </Button>
  );
}
