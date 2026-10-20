import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  if (user.submittedAt) redirect("/done");
  if (!user.instructionsAcknowledgedAt) redirect("/instructions");
  redirect("/evaluate");
}
