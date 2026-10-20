import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { Logo } from "@/components/ui";
import { currentUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <h1 className="text-lg font-semibold">Medical LLM Physician Evaluation</h1>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <h2 className="mb-1 font-semibold">Sign in</h2>
          <p className="mb-5 text-sm text-muted">Use the reviewer account provided by the study team.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
