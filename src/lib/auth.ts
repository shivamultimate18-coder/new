import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";

export type CurrentUser = { id: string; name: string; email: string; role: "admin" | "member" };

/** The signed-in user, checked against the database on every request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, session.uid));
  if (!u || !u.active || u.sessionVersion !== session.sv) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/accounts");
  return user;
}

export async function startSession(uid: string, sv: number) {
  (await cookies()).set(SESSION_COOKIE, await signSession({ uid, sv }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && !process.env.INSECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// Simple in-process login throttle: 5 failures per key per 15 minutes.
const failures = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;

export function loginBlocked(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (f.resetAt < Date.now()) {
    failures.delete(key);
    return false;
  }
  return f.count >= 5;
}

export function recordLoginFailure(key: string) {
  const f = failures.get(key);
  if (!f || f.resetAt < Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else f.count += 1;
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}
