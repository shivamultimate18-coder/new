"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import {
  clearLoginFailures,
  endSession,
  loginBlocked,
  recordLoginFailure,
  startSession,
} from "@/lib/auth";

// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export type LoginState = { error: string; email: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const fail = (error: string) => ({ error, email });
  if (!email || !password) return fail("Enter your email and password.");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const keys = [`email:${email}`, `ip:${ip}`];
  if (keys.some(loginBlocked)) return fail("Too many attempts. Try again in 15 minutes.");

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) {
    keys.forEach(recordLoginFailure);
    return fail("Wrong email or password.");
  }
  keys.forEach(clearLoginFailures);
  await startSession(user.id, user.sessionVersion);
  redirect("/accounts");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
