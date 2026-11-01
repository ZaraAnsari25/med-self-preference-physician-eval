import { NextResponse } from "next/server";
import { z } from "zod";
import { STUDY_IDS } from "@/lib/studies";
import { apiError, HttpError, requireApiUser } from "@/server/http";
import { applyPlan, PlanApplyError, previewPlan } from "@/server/plans";

const design = {
  study: z.enum(STUDY_IDS),
  reviewerIds: z.array(z.string()).max(200),
  calibrationCount: z.number().int().min(0).max(1000),
  gradersPerCase: z.number().int().min(1).max(200),
  seed: z.string().trim().min(1).max(100),
};
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ...design }),
  z.object({ action: z.literal("apply"), ...design }),
]);

export async function POST(req: Request) {
  try {
    const { db } = await requireApiUser(req, "admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const b = parsed.data;
    try {
      if (b.action === "preview") return NextResponse.json(await previewPlan(db, b));
      return NextResponse.json(await applyPlan(db, b));
    } catch (e) {
      if (e instanceof PlanApplyError) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (err) {
    return apiError(err);
  }
}
