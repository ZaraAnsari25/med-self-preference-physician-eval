import { notFound, redirect } from "next/navigation";
import { BeginButton } from "@/components/BeginButton";
import { InstructionsContent } from "@/components/InstructionsContent";
import { SimpleHeader } from "@/components/SimpleHeader";
import { STUDIES } from "@/lib/studies";
import { listQueue } from "@/server/evaluations";
import { pageStudy, requirePageUser } from "@/server/http";
import { getInstrumentConfig } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function InstructionsPage({ params }: { params: Promise<{ study: string }> }) {
  const study = pageStudy((await params).study);
  const { user, db } = await requirePageUser();
  if (user.role === "admin") redirect("/admin");
  const def = STUDIES[study];
  const [config, queue] = await Promise.all([getInstrumentConfig(db), listQueue(db, user.userId, study)]);
  if (queue.length === 0) notFound(); // nothing assigned in this study
  return (
    <>
      <SimpleHeader who={user.displayName ?? user.reviewerCode} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-1 text-sm font-medium text-accent">{def.name}</div>
        <h1 className="mb-1 text-2xl font-semibold">Welcome</h1>
        <p className="mb-6 text-muted">
          You have {queue.length} {def.unitNoun}
          {queue.length === 1 ? "" : "s"} assigned in this study. Please read these instructions before you begin.
        </p>
        <div className="rounded-xl border border-line bg-surface p-6">
          <InstructionsContent config={config} study={study} />
        </div>
        <div className="mt-6 flex justify-end">
          <BeginButton
            study={study}
            label={user.instructionsAck[study] ? "Continue grading" : "Begin evaluation"}
          />
        </div>
      </main>
    </>
  );
}
