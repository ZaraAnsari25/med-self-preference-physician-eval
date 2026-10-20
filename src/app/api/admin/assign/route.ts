import { NextResponse } from "next/server";
import { z } from "zod";
import { assignItems } from "@/server/admin";
import { apiError, HttpError, requireApiUser } from "@/server/http";

const body = z.object({
  reviewerIds: z.array(z.string()).min(1),
  start: z.number().int().min(0),
  count: z.number().int().min(1).max(1000),
});

export async function POST(req: Request) {
  try {
    const { db } = await requireApiUser(req, "admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const results: Record<string, number> = {};
    for (const id of parsed.data.reviewerIds) {
      try {
        results[id] = (await assignItems(db, id, parsed.data)).assigned;
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : "Assignment failed");
      }
    }
    return NextResponse.json({ results });
  } catch (err) {
    return apiError(err);
  }
}
