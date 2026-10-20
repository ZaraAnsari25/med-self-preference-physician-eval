import { NextResponse } from "next/server";
import { submitAll } from "@/server/evaluations";
import { apiError, requireApiUser } from "@/server/http";

export async function POST(req: Request) {
  try {
    const { user, db } = await requireApiUser(req, "reviewer");
    return NextResponse.json(await submitAll(db, user.userId));
  } catch (err) {
    return apiError(err);
  }
}
