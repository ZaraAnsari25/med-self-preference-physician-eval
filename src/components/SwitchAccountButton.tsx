"use client";

import { Button } from "./ui";

export function SwitchAccountButton() {
  return (
    <Button
      size="lg"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      Sign out and switch account
    </Button>
  );
}
