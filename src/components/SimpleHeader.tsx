import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { Logo } from "./ui";

export function SimpleHeader({ who, children }: { who?: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-semibold">Medical LLM Physician Evaluation</span>
        </Link>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {children}
          {who && (
            <span className="text-muted">
              Signed in as <span className="font-semibold text-ink">{who}</span>
            </span>
          )}
          {who && <LogoutButton />}
        </div>
      </div>
    </header>
  );
}
