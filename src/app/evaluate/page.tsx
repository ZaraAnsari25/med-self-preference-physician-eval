import { redirect } from "next/navigation";
import { listQueue, resumePosition } from "@/server/evaluations";
import { requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

/** Resume at the first incomplete question. */
export default async function EvaluateIndex() {
  const { user, db } = await requirePageUser("reviewer");
  if (!user.instructionsAcknowledgedAt) redirect("/instructions");
  const position = resumePosition(await listQueue(db, user.userId));
  redirect(position ? `/evaluate/${position}` : "/instructions");
}
