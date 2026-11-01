import { NextResponse } from "next/server";
import { submitAll } from "@/server/evaluations";
import { apiError, apiStudy, requireApiUser } from "@/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ study: string }> }) {
  try {
    const study = apiStudy((await ctx.params).study);
    const { user, db } = await requireApiUser(req, "reviewer");
    return NextResponse.json(await submitAll(db, user.userId, study));
  } catch (err) {
    return apiError(err);
  }
}
