import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { EvaluationError, listQueue, loadEvaluation, reviewerStudies } from "@/server/evaluations";
import { pageStudy, requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function EvaluatePage({ params }: { params: Promise<{ study: string; position: string }> }) {
  const p = await params;
  const study = pageStudy(p.study);
  const { user, db } = await requirePageUser("reviewer");
  const position = Number(p.position);
  if ((await listQueue(db, user.userId, study)).length === 0) notFound(); // nothing assigned in this study
  if (!user.instructionsAck[study]) redirect(`/study/${study}/instructions`);
  try {
    const [payload, queue, studies] = await Promise.all([
      loadEvaluation(db, user.userId, study, position),
      listQueue(db, user.userId, study),
      reviewerStudies(db, user.userId),
    ]);
    return (
      <Workspace
        key={`${study}-${position}`}
        payload={payload}
        queue={queue}
        reviewerCode={user.reviewerCode}
        displayName={user.displayName}
        hasOtherStudies={studies.length > 1}
      />
    );
  } catch (err) {
    if (err instanceof EvaluationError && err.status === 404) notFound();
    throw err;
  }
}
