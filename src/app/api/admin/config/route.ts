import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireApiUser } from "@/server/http";
import { setInstrumentConfig } from "@/server/settings";

const body = z.object({ rubricMode: z.enum(["required", "optional", "off"]), errorMode: z.enum(["optional", "off"]) });

export async function POST(req: Request) {
  try {
    const { db } = await requireApiUser(req, "admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid configuration");
    await setInstrumentConfig(db, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
