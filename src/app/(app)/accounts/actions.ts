"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import { createHostedAuthLink, deleteAccount } from "@/lib/unipile";

/** Members manage their own accounts; admins manage all of them. */
async function loadAccount(user: CurrentUser, id: string) {
  const [row] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
  if (!row) return null;
  if (user.role !== "admin" && row.ownerUserId !== user.id) return null;
  return row;
}

export async function connectAccount() {
  const user = await requireUser();
  const [row] = await db
    .insert(schema.accounts)
    .values({ ownerUserId: user.id, name: `${user.name}'s account` })
    .returning();
  let url: string;
  try {
    url = await createHostedAuthLink({ rowId: row.id });
  } catch (e) {
    console.error(e);
    await db.delete(schema.accounts).where(eq(schema.accounts.id, row.id));
    redirect("/accounts?error=link");
  }
  redirect(url);
}

export async function reconnectAccount(formData: FormData) {
  const user = await requireUser();
  const row = await loadAccount(user, String(formData.get("id")));
  if (!row) return;
  let url: string;
  try {
    url = await createHostedAuthLink({
      rowId: row.id,
      reconnectUnipileAccountId: row.unipileAccountId ?? undefined,
    });
  } catch (e) {
    console.error(e);
    redirect("/accounts?error=link");
  }
  redirect(url);
}

export async function setEnabled(formData: FormData) {
  const user = await requireUser();
  const row = await loadAccount(user, String(formData.get("id")));
  if (!row) return;
  const enabled = formData.get("enabled") === "1";
  if (enabled && row.status !== "ok") return; // only connected accounts can be switched on
  await db
    .update(schema.accounts)
    // Switching on again clears a pause from the sending engine.
    .set(enabled ? { enabled, pausedReason: null, consecutiveErrors: 0, nextActionAt: null } : { enabled })
    .where(and(eq(schema.accounts.id, row.id)));
  await db.insert(schema.activityLog).values({
    accountId: row.id,
    userId: user.id,
    type: enabled ? "account.enabled" : "account.disabled",
  });
  revalidatePath("/accounts");
}

export async function setSalesNav(formData: FormData) {
  const user = await requireUser();
  const row = await loadAccount(user, String(formData.get("id")));
  if (!row) return;
  await db
    .update(schema.accounts)
    .set({ hasSalesNav: formData.get("value") === "1" })
    .where(eq(schema.accounts.id, row.id));
  revalidatePath("/accounts");
}

export async function removeAccount(formData: FormData) {
  const user = await requireUser();
  const row = await loadAccount(user, String(formData.get("id")));
  if (!row) return;
  if (row.unipileAccountId && row.status !== "disconnected") {
    try {
      await deleteAccount(row.unipileAccountId);
    } catch (e) {
      // Keep our row so the Unipile seat is not orphaned (and still billed).
      console.error(e);
      redirect("/accounts?error=remove");
    }
  }
  await db.delete(schema.accounts).where(eq(schema.accounts.id, row.id));
  revalidatePath("/accounts");
}
