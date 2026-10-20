import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { EvaluationError, listQueue, loadEvaluation } from "@/server/evaluations";
import { requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function EvaluatePage({ params }: { params: Promise<{ position: string }> }) {
  const { user, db } = await requirePageUser("reviewer");
  if (!user.instructionsAcknowledgedAt) redirect("/instructions");
  const position = Number((await params).position);
  try {
    const [payload, queue] = await Promise.all([loadEvaluation(db, user.userId, position), listQueue(db, user.userId)]);
    return (
      <Workspace
        key={position}
        payload={payload}
        queue={queue}
        reviewerCode={user.reviewerCode}
        displayName={user.displayName}
      />
    );
  } catch (err) {
    if (err instanceof EvaluationError && err.status === 404) notFound();
    throw err;
  }
}
