"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { INTENTS } from "@/db/schema";
import type { Intent } from "@/db/schema";
import { friendlyAiError } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import { classifyConversation, sendReply, suggestReply, syncAccount } from "@/lib/inbox";
import { enqueueClassify } from "@/lib/queue";
import { UnipileError } from "@/lib/unipile";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

async function loadConversation(id: string) {
  if (!isId(id)) return null;
  const [row] = await db
    .select({ conv: schema.conversations, account: schema.accounts })
    .from(schema.conversations)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.conversations.accountId))
    .where(eq(schema.conversations.id, id));
  return row ?? null;
}

/** Writing as a LinkedIn account is limited to its owner and admins. */
const canSendAs = (u: CurrentUser, a: { ownerUserId: string | null }) => u.role === "admin" || a.ownerUserId === u.id;

export async function markRead(id: string) {
  await requireUser();
  if (!isId(id)) return;
  await db.update(schema.conversations).set({ unread: false }).where(eq(schema.conversations.id, id));
  revalidatePath("/inbox");
}

export async function markUnread(fd: FormData) {
  await requireUser();
  const id = String(fd.get("id"));
  if (!isId(id)) return;
  await db.update(schema.conversations).set({ unread: true }).where(eq(schema.conversations.id, id));
  revalidatePath("/inbox");
}

/** A teammate's label wins over the AI and is never overwritten. "auto" hands it back to the AI. */
export async function setIntent(fd: FormData) {
  await requireUser();
  const id = String(fd.get("id"));
  const value = String(fd.get("intent"));
  if (!isId(id)) return;
  if (value === "auto") {
    await db.update(schema.conversations).set({ intentSource: null, intentReason: null }).where(eq(schema.conversations.id, id));
    try {
      await enqueueClassify(id);
    } catch {
      await classifyConversation(id).catch(() => {});
    }
  } else if ((INTENTS as readonly string[]).includes(value)) {
    await db
      .update(schema.conversations)
      .set({ intent: value as Intent, intentSource: "manual", intentReason: null })
      .where(eq(schema.conversations.id, id));
  }
  revalidatePath("/inbox");
}

export async function toggleTag(fd: FormData) {
  await requireUser();
  const conversationId = String(fd.get("id"));
  const tagId = String(fd.get("tagId"));
  if (!isId(conversationId) || !isId(tagId)) return;
  const deleted = await db
    .delete(schema.conversationTags)
    .where(and(eq(schema.conversationTags.conversationId, conversationId), eq(schema.conversationTags.tagId, tagId)))
    .returning();
  if (!deleted.length) await db.insert(schema.conversationTags).values({ conversationId, tagId }).onConflictDoNothing();
  revalidatePath("/inbox");
}

export async function suggestInboxReply(id: string): Promise<{ text?: string; error?: string }> {
  const user = await requireUser();
  const row = await loadConversation(id);
  if (!row) return { error: "Conversation not found." };
  try {
    return { text: await suggestReply(id, user.id) };
  } catch (e) {
    console.error(e);
    return { error: friendlyAiError(e) };
  }
}

export async function sendInboxReply(id: string, text: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  const row = await loadConversation(id);
  if (!row) return { error: "Conversation not found." };
  if (!canSendAs(user, row.account)) return { error: "Only the account's owner or an admin can reply from this LinkedIn account." };
  if (row.account.status !== "ok") return { error: "This LinkedIn account is not connected. Reconnect it on the Accounts page first." };
  const body = text.trim();
  if (!body) return { error: "Write a reply first." };
  if (body.length > 3000) return { error: "The reply is too long (3,000 characters at most)." };
  try {
    await sendReply(row.conv, row.account, body, user.id);
  } catch (e) {
    console.error(e);
    return { error: e instanceof UnipileError ? `LinkedIn did not accept the message (${e.status}). Try again, or reply on LinkedIn.` : "Could not send the reply. Try again." };
  }
  revalidatePath("/inbox");
  return { ok: true };
}

export async function syncInbox(): Promise<{ added?: number; error?: string }> {
  const user = await requireUser();
  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.status, "ok"), user.role === "admin" ? undefined : eq(schema.accounts.ownerUserId, user.id)));
  let added = 0;
  const failed: string[] = [];
  for (const a of accounts) {
    try {
      added += await syncAccount(a);
    } catch (e) {
      console.error(e);
      failed.push(a.name || "an account");
    }
  }
  revalidatePath("/inbox");
  if (failed.length) return { added, error: `Could not sync ${failed.join(", ")}.` };
  return { added };
}

// ---------------------------------------------------------------------------
// Tags (Settings > Tags)

export async function createTag(fd: FormData) {
  await requireUser();
  const name = String(fd.get("name") ?? "").trim().slice(0, 40);
  const color = String(fd.get("color") ?? "slate");
  if (!name) return;
  await db.insert(schema.tags).values({ name, color }).onConflictDoNothing();
  revalidatePath("/settings/tags");
}

export async function updateTag(fd: FormData) {
  await requireUser();
  const id = String(fd.get("id"));
  const name = String(fd.get("name") ?? "").trim().slice(0, 40);
  const color = String(fd.get("color") ?? "slate");
  if (!isId(id) || !name) return;
  await db.update(schema.tags).set({ name, color }).where(eq(schema.tags.id, id)).catch(() => {});
  revalidatePath("/settings/tags");
}

export async function deleteTag(fd: FormData) {
  const user = await requireUser();
  if (user.role !== "admin") return;
  const ids = fd.getAll("id").map(String).filter(isId);
  if (ids.length) await db.delete(schema.tags).where(inArray(schema.tags.id, ids));
  revalidatePath("/settings/tags");
}
