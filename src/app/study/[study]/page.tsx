import { notFound, redirect } from "next/navigation";
import { listQueue, resumePosition, submissionSummary } from "@/server/evaluations";
import { pageStudy, requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

/** Study entry: instructions first, then resume at the first incomplete question. */
export default async function StudyIndex({ params }: { params: Promise<{ study: string }> }) {
  const study = pageStudy((await params).study);
  const { user, db } = await requirePageUser("reviewer");
  const position = resumePosition(await listQueue(db, user.userId, study));
  if (!position) notFound(); // nothing assigned in this study
  if (!user.instructionsAck[study]) redirect(`/study/${study}/instructions`);
  if ((await submissionSummary(db, user.userId, study)).submittedAt) redirect(`/study/${study}/done`);
  redirect(`/study/${study}/q/${position}`);
}
