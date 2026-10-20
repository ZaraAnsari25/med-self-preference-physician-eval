import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { login } from "@/server/auth";
import { apiError, assertSameOrigin, HttpError, sessionCookie } from "@/server/http";

const body = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    await assertSameOrigin(req);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Enter a username and password");
    const result = await login(await getDb(), parsed.data.username, parsed.data.password);
    if (!result) throw new HttpError(401, "Incorrect username or password");
    const res = NextResponse.json({ role: result.user.role });
    res.cookies.set(sessionCookie(result.token));
    return res;
  } catch (err) {
    return apiError(err);
  }
}
