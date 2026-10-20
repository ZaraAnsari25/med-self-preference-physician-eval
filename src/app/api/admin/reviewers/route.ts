import { NextResponse } from "next/server";
import { z } from "zod";
import { setReviewerActive } from "@/server/admin";
import { createUser, generatePassword, setPassword } from "@/server/auth";
import { apiError, HttpError, requireApiUser } from "@/server/http";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    username: z.string().min(3).max(64),
    displayName: z.string().max(120).optional(),
    role: z.enum(["reviewer", "admin"]).default("reviewer"),
  }),
  z.object({ action: z.literal("reset_password"), userId: z.string() }),
  z.object({ action: z.literal("set_active"), userId: z.string(), active: z.boolean() }),
]);

export async function POST(req: Request) {
  try {
    const { db } = await requireApiUser(req, "admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const b = parsed.data;
    if (b.action === "create") {
      const password = generatePassword();
      try {
        const u = await createUser(db, { username: b.username, password, role: b.role, displayName: b.displayName || null });
        return NextResponse.json({ ...u, password });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message.replace(/^.*duplicate key.*$/s, "Username already exists") : "Could not create user");
      }
    }
    if (b.action === "reset_password") {
      const password = generatePassword();
      await setPassword(db, b.userId, password);
      return NextResponse.json({ password });
    }
    await setReviewerActive(db, b.userId, b.active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
