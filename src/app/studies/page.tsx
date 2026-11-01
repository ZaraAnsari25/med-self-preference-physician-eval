import Link from "next/link";
import { SimpleHeader } from "@/components/SimpleHeader";
import { Pill } from "@/components/ui";
import { STUDIES } from "@/lib/studies";
import { reviewerStudies } from "@/server/evaluations";
import { requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function StudiesPage() {
  const { user, db } = await requirePageUser("reviewer");
  const studies = await reviewerStudies(db, user.userId);
  return (
    <>
      <SimpleHeader who={user.displayName ?? user.reviewerCode} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-1 text-2xl font-semibold">Your evaluations</h1>
        <p className="mb-6 text-muted">Each study is a separate task with its own instructions. Complete and submit them independently.</p>
        {studies.length === 0 && (
          <div className="rounded-xl border border-line bg-surface p-6 text-ink-2">No questions are assigned to you yet.</div>
        )}
        <div className="space-y-3">
          {studies.map((s) => {
            const def = STUDIES[s.study];
            return (
              <Link
                key={s.study}
                href={`/study/${s.study}`}
                className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 hover:border-line-strong"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{def.name}</div>
                  <div className="text-sm text-muted">{def.task}</div>
                </div>
                <div className="text-right text-sm">
                  {s.submittedAt ? (
                    <Pill tone="done">Submitted</Pill>
                  ) : (
                    <span className="tabular-nums text-ink-2">
                      {s.complete} of {s.total} {def.unitNoun}s completed
                    </span>
                  )}
                </div>
                <span aria-hidden className="text-muted">→</span>
              </Link>
            );
          })}
        </div>
      </main>
    </>
  );
}
