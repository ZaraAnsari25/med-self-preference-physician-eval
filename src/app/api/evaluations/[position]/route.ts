import { NextResponse } from "next/server";
import { z } from "zod";
import { saveEvaluation } from "@/server/evaluations";
import { apiError, HttpError, requireApiUser } from "@/server/http";

const body = z.object({
  state: z.unknown(),
  baseRevision: z.number().int().min(0),
  activeMsDelta: z.number().min(0).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ position: string }> }) {
  try {
    const { user, db } = await requireApiUser(req, "reviewer");
    const position = Number((await ctx.params).position);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Malformed save request");
    const result = await saveEvaluation(db, user.userId, position, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
