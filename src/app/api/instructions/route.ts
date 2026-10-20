import { NextResponse } from "next/server";
import { acknowledgeInstructions } from "@/server/evaluations";
import { apiError, requireApiUser } from "@/server/http";

export async function POST(req: Request) {
  try {
    const { user, db } = await requireApiUser(req);
    await acknowledgeInstructions(db, user.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
