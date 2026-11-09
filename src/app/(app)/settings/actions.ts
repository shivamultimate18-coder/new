"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { BUDGET_KEY, clearBudgetCache, setSetting } from "@/lib/budget";
import { forgetPerson, idsFromInput, suppress } from "@/lib/suppression";

export type ListState = { message?: string; error?: string } | null;

export async function addToDoNotContact(_prev: ListState, fd: FormData): Promise<ListState> {
  const user = await requireUser();
  const reason = String(fd.get("reason") ?? "").trim() || "Added by a teammate";
  const lines = String(fd.get("profiles") ?? "")
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500);
  if (!lines.length) return { error: "Paste at least one LinkedIn profile link." };
  let added = 0;
  const unreadable: string[] = [];
  for (const line of lines) {
    const ids = idsFromInput(line);
    if (!ids) {
      unreadable.push(line);
      continue;
    }
    if (await suppress(ids, { label: line.slice(0, 200), reason, userId: user.id })) added++;
  }
  revalidatePath("/settings/do-not-contact");
  const already = lines.length - added - unreadable.length;
  return {
    message: `${added} added.${already ? ` ${already} already on the list.` : ""}`,
    ...(unreadable.length
      ? { error: `Could not read ${unreadable.length}: ${unreadable.slice(0, 3).join(", ")}${unreadable.length > 3 ? "…" : ""}` }
      : {}),
  };
}

export async function removeFromDoNotContact(fd: FormData) {
  await requireAdmin();
  const ids = fd
    .getAll("id")
    .map(String)
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  // Entries from a deletion request stay: taking them off would let the person be imported again.
  const rows = ids.length ? await db.select().from(schema.suppressionList).where(inArray(schema.suppressionList.id, ids)) : [];
  const allowed = rows.filter((r) => r.reason !== "Deletion request").map((r) => r.id);
  if (allowed.length) await db.delete(schema.suppressionList).where(inArray(schema.suppressionList.id, allowed));
  revalidatePath("/settings/do-not-contact");
}

export async function forgetPersonAction(_prev: ListState, fd: FormData): Promise<ListState> {
  const user = await requireAdmin();
  const ids = idsFromInput(String(fd.get("profile") ?? ""));
  if (!ids) return { error: "Paste the person's LinkedIn profile link." };
  const r = await forgetPerson(ids, user.id);
  revalidatePath("/settings/do-not-contact");
  return {
    message: `Deleted ${r.leads} lead record${r.leads === 1 ? "" : "s"} and ${r.conversations} conversation${r.conversations === 1 ? "" : "s"}. Their LinkedIn identifier stays on the do-not-contact list so they are not imported again.`,
  };
}

export async function setAiBudget(_prev: ListState, fd: FormData): Promise<ListState> {
  await requireAdmin();
  const raw = String(fd.get("budget") ?? "").trim();
  const value = raw === "" ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100_000)) {
    return { error: "Enter an amount in US dollars, or leave it empty for no limit." };
  }
  await setSetting(BUDGET_KEY, value);
  clearBudgetCache();
  revalidatePath("/settings/usage");
  return { message: value === null ? "No monthly limit." : `Monthly limit set to $${value.toLocaleString()}.` };
}

/** Inbox: stop contacting the person in a conversation. */
export async function doNotContactConversation(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const [row] = await db
    .select({ conv: schema.conversations, lead: schema.leads })
    .from(schema.conversations)
    .leftJoin(schema.leads, eq(schema.leads.id, schema.conversations.leadId))
    .where(eq(schema.conversations.id, id));
  if (!row) return;
  await suppress(
    {
      providerId: row.conv.prospectProviderId ?? row.lead?.providerId,
      linkedinId: row.lead?.linkedinId,
      publicIdentifier: row.lead?.publicIdentifier,
    },
    { label: row.conv.prospectName || "From the inbox", reason: "Marked in the inbox", userId: user.id },
  );
  revalidatePath("/inbox");
}
