import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";
import { SwitchAccountButton } from "@/components/SwitchAccountButton";
import { Logo } from "@/components/ui";
import { currentUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <h1 className="text-lg font-semibold">Medical LLM Physician Evaluation</h1>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          {user ? (
            <>
              <h2 className="mb-1 font-semibold">You are already signed in</h2>
              <p className="mb-5 text-sm text-ink-2">
                This browser is signed in as <strong>{user.displayName ?? user.reviewerCode}</strong>
                {user.role === "admin" ? " (admin)" : ""}. Every tab in this browser window shares that sign-in, so switching here
                switches all tabs. To use two accounts at once, open the other one in an Incognito window or a different browser.
              </p>
              <div className="flex flex-col gap-2">
                <Link
                  href="/"
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-accent bg-accent px-5 text-[0.95rem] font-medium text-white hover:bg-accent-hover"
                >
                  Continue as {user.displayName ?? user.reviewerCode}
                </Link>
                <SwitchAccountButton />
              </div>
            </>
          ) : (
            <>
              <h2 className="mb-1 font-semibold">Sign in</h2>
              <p className="mb-5 text-sm text-muted">Use the reviewer account provided by the study team.</p>
              <LoginForm />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
