"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";

export type AddResult = { error?: string; created?: { email: string; password: string } } | null;

export async function addMember(_prev: AddResult, formData: FormData): Promise<AddResult> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = formData.get("role") === "admin" ? "admin" : "member";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return { error: "Enter a name and a valid email." };
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existing) return { error: "Someone with that email already has a login." };
  const password = randomBytes(12).toString("base64url");
  await db.insert(schema.users).values({ email, name, role, passwordHash: await bcrypt.hash(password, 12) });
  revalidatePath("/settings/team");
  return { created: { email, password } };
}

export async function setActive(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  if (id === admin.id) return; // cannot lock yourself out
  await db
    .update(schema.users)
    .set({ active: formData.get("active") === "1", sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, id));
  revalidatePath("/settings/team");
}

export async function resetPassword(_prev: AddResult, formData: FormData): Promise<AddResult> {
  await requireAdmin();
  const id = String(formData.get("id"));
  const password = randomBytes(12).toString("base64url");
  const [u] = await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(password, 12), sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, id))
    .returning();
  if (!u) return { error: "User not found." };
  return { created: { email: u.email, password } };
}
