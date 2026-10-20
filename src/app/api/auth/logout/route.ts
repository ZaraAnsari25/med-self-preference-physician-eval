import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { logout, SESSION_COOKIE } from "@/server/auth";
import { apiError, assertSameOrigin } from "@/server/http";

export async function POST(req: Request) {
  try {
    await assertSameOrigin(req);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) await logout(await getDb(), token);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (err) {
    return apiError(err);
  }
}
