import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getDb, type DB } from "@/db";
import { SESSION_COOKIE, SESSION_TTL_MS, userForToken, type Role, type SessionUser } from "./auth";
import { EvaluationError } from "./evaluations";

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForToken(await getDb(), token);
}

/** For server components: redirect to /login (or home) when not allowed. */
export async function requirePageUser(role?: Role): Promise<{ user: SessionUser; db: DB }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect("/");
  return { user, db: await getDb() };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** For route handlers: authenticated user with the right role, same-origin writes only. */
export async function requireApiUser(req: Request, role?: Role): Promise<{ user: SessionUser; db: DB }> {
  if (req.method !== "GET") await assertSameOrigin(req);
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  if (role && user.role !== role) throw new HttpError(403, "Not permitted");
  return { user, db: await getDb() };
}

export async function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = (await headers()).get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request rejected");
}

export function apiError(err: unknown) {
  if (err instanceof HttpError || err instanceof EvaluationError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
