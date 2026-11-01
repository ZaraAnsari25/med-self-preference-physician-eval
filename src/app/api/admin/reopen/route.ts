import { NextResponse } from "next/server";
import { z } from "zod";
import { STUDY_IDS } from "@/lib/studies";
import { reopenSubmission } from "@/server/evaluations";
import { apiError, HttpError, requireApiUser } from "@/server/http";

export async function POST(req: Request) {
  try {
    const { db } = await requireApiUser(req, "admin");
    const parsed = z.object({ userId: z.string(), study: z.enum(STUDY_IDS) }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    await reopenSubmission(db, parsed.data.userId, parsed.data.study);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
