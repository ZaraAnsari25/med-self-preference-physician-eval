import { redirect } from "next/navigation";
import { BeginButton } from "@/components/BeginButton";
import { InstructionsContent } from "@/components/InstructionsContent";
import { SimpleHeader } from "@/components/SimpleHeader";
import { listQueue } from "@/server/evaluations";
import { requirePageUser } from "@/server/http";
import { getInstrumentConfig } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function InstructionsPage() {
  const { user, db } = await requirePageUser();
  if (user.role === "admin") redirect("/admin");
  const [config, queue] = await Promise.all([getInstrumentConfig(db), listQueue(db, user.userId)]);
  return (
    <>
      <SimpleHeader who={user.displayName ?? user.reviewerCode} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-1 text-2xl font-semibold">Welcome</h1>
        <p className="mb-6 text-muted">
          You have {queue.length} question{queue.length === 1 ? "" : "s"} assigned. Please read these instructions before you
          begin.
        </p>
        <div className="rounded-xl border border-line bg-surface p-6">
          <InstructionsContent config={config} />
        </div>
        <div className="mt-6 flex justify-end">
          <BeginButton disabled={queue.length === 0} label={user.instructionsAcknowledgedAt ? "Continue grading" : "Begin evaluation"} />
        </div>
        {queue.length === 0 && <p className="mt-3 text-right text-sm text-muted">No questions are assigned to you yet.</p>}
      </main>
    </>
  );
}
