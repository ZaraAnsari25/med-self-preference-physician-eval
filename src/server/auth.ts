import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, lt, max, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { sessions, users } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";

export const SESSION_COOKIE = "pe_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type Role = "reviewer" | "admin";
export interface SessionUser {
  userId: string;
  reviewerCode: string;
  displayName: string | null;
  role: Role;
  /** { [study]: ISO timestamp } of acknowledged study instructions. */
  instructionsAck: Record<string, string>;
}

export async function createUser(
  db: DB,
  input: {
    username: string;
    password: string;
    role: Role;
    displayName?: string | null;
    reviewerCode?: string;
    specialty?: string | null;
    yearsInPractice?: number | null;
  },
) {
  if (input.password.length < 10) throw new Error("password must be at least 10 characters");
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error("username must be 3-64 chars of a-z 0-9 . _ -");
  const passwordHash = await bcrypt.hash(input.password, 12);
  return db.transaction(async (tx) => {
    const [{ slot }] = await tx.select({ slot: max(users.reviewerSlot) }).from(users);
    const reviewerSlot = (slot ?? -1) + 1;
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, input.role));
    const reviewerCode = input.reviewerCode ?? `${input.role === "admin" ? "A" : "R"}${String(n + 1).padStart(3, "0")}`;
    const userId = randomUUID();
    await tx.insert(users).values({
      userId,
      reviewerCode,
      username,
      displayName: input.displayName ?? null,
      specialty: input.specialty?.trim() || null,
      yearsInPractice: input.yearsInPractice ?? null,
      passwordHash,
      role: input.role,
      reviewerSlot,
    });
    return { userId, reviewerCode, username };
  });
}

export async function setPassword(db: DB, userId: string, password: string) {
  if (password.length < 10) throw new Error("password must be at least 10 characters");
  await db.update(users).set({ passwordHash: await bcrypt.hash(password, 12) }).where(eq(users.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

// Constant-ish time for unknown usernames.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

export async function login(db: DB, username: string, password: string): Promise<{ token: string; user: SessionUser } | null> {
  const [u] = await db.select().from(users).where(eq(users.username, username.trim().toLowerCase()));
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok || !u.active) return null;
  const token = randomBytes(32).toString("base64url");
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await db.insert(sessions).values({
    tokenHash: sha256Hex(token),
    userId: u.userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { token, user: toSessionUser(u) };
}

export async function logout(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

export async function userForToken(db: DB, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.userId, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, sql`now()`), eq(users.active, true)));
  return row ? toSessionUser(row.u) : null;
}

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
  return {
    userId: u.userId,
    reviewerCode: u.reviewerCode,
    displayName: u.displayName,
    role: u.role,
    instructionsAck: u.instructionsAck ?? {},
  };
}
