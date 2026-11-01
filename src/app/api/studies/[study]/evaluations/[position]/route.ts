import { NextResponse } from "next/server";
import { z } from "zod";
import { saveEvaluation } from "@/server/evaluations";
import { apiError, apiStudy, HttpError, requireApiUser } from "@/server/http";

const body = z.object({
  state: z.unknown(),
  baseRevision: z.number().int().min(0),
  activeMsDelta: z.number().min(0).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ study: string; position: string }> }) {
  try {
    const p = await ctx.params;
    const study = apiStudy(p.study);
    const { user, db } = await requireApiUser(req, "reviewer");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Malformed save request");
    return NextResponse.json(await saveEvaluation(db, user.userId, study, Number(p.position), parsed.data));
  } catch (err) {
    return apiError(err);
  }
}
