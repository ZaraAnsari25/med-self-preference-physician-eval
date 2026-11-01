import Link from "next/link";
import { redirect } from "next/navigation";
import { SimpleHeader } from "@/components/SimpleHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { STUDIES } from "@/lib/studies";
import { submissionSummary } from "@/server/evaluations";
import { pageStudy, requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function SubmitPage({ params }: { params: Promise<{ study: string }> }) {
  const study = pageStudy((await params).study);
  const { user, db } = await requirePageUser("reviewer");
  const def = STUDIES[study];
  const s = await submissionSummary(db, user.userId, study);
  if (s.submittedAt) redirect(`/study/${study}/done`);
  const ready = s.total > 0 && s.incomplete.length === 0;
  return (
    <>
      <SimpleHeader who={user.displayName ?? user.reviewerCode} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-1 text-sm font-medium text-accent">{def.name}</div>
        <h1 className="mb-6 text-2xl font-semibold">Review and submit</h1>
        <div className="rounded-xl border border-line bg-surface p-6">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted">{def.unitNoun[0].toUpperCase() + def.unitNoun.slice(1)}s completed</dt>
              <dd className="text-3xl font-semibold tabular-nums">
                {s.complete} <span className="text-lg text-muted">/ {s.total}</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Incomplete</dt>
              <dd className="text-3xl font-semibold tabular-nums">{s.incomplete.length}</dd>
            </div>
          </dl>
          {s.incomplete.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium">These {def.unitNoun}s still need scores or a confirmed ranking:</p>
              <div className="flex flex-wrap gap-1.5">
                {s.incomplete.map((p) => (
                  <Link
                    key={p}
                    href={`/study/${study}/q/${p}`}
                    className="h-8 min-w-9 rounded-md border border-progress-line bg-progress-soft px-2 py-1 text-center font-mono text-sm text-progress hover:border-progress"
                  >
                    {p}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="mt-8 border-t border-line pt-5">
            <p className="mb-4 text-sm text-ink-2">
              After you submit, your {def.name} evaluations are locked and can only be reopened by the study team.
            </p>
            <div className="flex items-center justify-between gap-3">
              <Link href={`/study/${study}`} className="text-sm font-medium text-ink-2 underline underline-offset-2">
                ← Back to grading
              </Link>
              <SubmitButton study={study} disabled={!ready} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
