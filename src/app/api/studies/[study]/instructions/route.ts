import { NextResponse } from "next/server";
import { acknowledgeInstructions } from "@/server/evaluations";
import { apiError, apiStudy, requireApiUser } from "@/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ study: string }> }) {
  try {
    const study = apiStudy((await ctx.params).study);
    const { user, db } = await requireApiUser(req, "reviewer");
    await acknowledgeInstructions(db, user.userId, study);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
