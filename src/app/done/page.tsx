import { redirect } from "next/navigation";
import { SimpleHeader } from "@/components/SimpleHeader";
import { submissionSummary } from "@/server/evaluations";
import { requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function DonePage() {
  const { user, db } = await requirePageUser("reviewer");
  const s = await submissionSummary(db, user.userId);
  if (!s.submittedAt) redirect("/evaluate");
  return (
    <>
      <SimpleHeader who={user.displayName ?? user.reviewerCode} />
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-done-soft text-2xl text-done">✓</div>
        <h1 className="mb-2 text-2xl font-semibold">Thank you</h1>
        <p className="text-ink-2">
          Your evaluations of {s.complete} question{s.complete === 1 ? "" : "s"} were submitted on{" "}
          {s.submittedAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}.
        </p>
        <p className="mt-2 text-sm text-muted">You can close this window. Contact the study team if you need to make a change.</p>
      </main>
    </>
  );
}
