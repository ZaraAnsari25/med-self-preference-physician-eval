"use client";

import { Button } from "./ui";

export function LogoutButton({ beforeLogout }: { beforeLogout?: () => Promise<boolean> }) {
  const onClick = async () => {
    if (beforeLogout && !(await beforeLogout())) {
      if (!window.confirm("Your latest changes could not be saved. Log out anyway?")) return;
    }
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };
  return (
    <Button variant="ghost" onClick={onClick}>
      Log out
    </Button>
  );
}
