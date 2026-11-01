import Link from "next/link";
import { redirect } from "next/navigation";
import { SimpleHeader } from "@/components/SimpleHeader";
import { STUDIES } from "@/lib/studies";
import { reviewerStudies, submissionSummary } from "@/server/evaluations";
import { pageStudy, requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function DonePage({ params }: { params: Promise<{ study: string }> }) {
  const study = pageStudy((await params).study);
  const { user, db } = await requirePageUser("reviewer");
  const def = STUDIES[study];
  const [s, studies] = await Promise.all([submissionSummary(db, user.userId, study), reviewerStudies(db, user.userId)]);
  if (!s.submittedAt) redirect(`/study/${study}`);
  const unfinished = studies.filter((x) => !x.submittedAt);
  return (
    <>
      <SimpleHeader who={user.displayName ?? user.reviewerCode} />
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-done-soft text-2xl text-done">✓</div>
        <h1 className="mb-2 text-2xl font-semibold">Thank you</h1>
        <p className="text-ink-2">
          Your {def.name} evaluations of {s.complete} {def.unitNoun}
          {s.complete === 1 ? "" : "s"} were submitted on{" "}
          {s.submittedAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}.
        </p>
        {unfinished.length > 0 ? (
          <Link href="/studies" className="mt-6 inline-block text-sm font-medium text-accent underline underline-offset-2">
            Continue with your other evaluations →
          </Link>
        ) : (
          <p className="mt-2 text-sm text-muted">You can close this window. Contact the study team if you need to make a change.</p>
        )}
      </main>
    </>
  );
}
