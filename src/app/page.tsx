import { redirect } from "next/navigation";
import { reviewerStudies } from "@/server/evaluations";
import { requirePageUser } from "@/server/http";

export const dynamic = "force-dynamic";

/** Admins go to the dashboard; reviewers with one study go straight to it, otherwise to the picker. */
export default async function Home() {
  const { user, db } = await requirePageUser();
  if (user.role === "admin") redirect("/admin");
  const studies = await reviewerStudies(db, user.userId);
  if (studies.length === 1) redirect(`/study/${studies[0].study}`);
  redirect("/studies");
}
