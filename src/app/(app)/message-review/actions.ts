"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import type { RuleSet } from "@/db/schema";
import { friendlyAiError } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { generateDrafts, messageSteps, releaseIfApproved } from "@/lib/drafting";
import { checkMessage, proposeRules } from "@/lib/voice/compose";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

/** Approves every unsent draft of the given leads. */
export async function approveLeads(fd: FormData) {
  const user = await requireUser();
  const ids = fd.getAll("leadStateId").map(String).filter(isId);
  if (!ids.length) return;
  await db
    .update(schema.messageDrafts)
    .set({ status: "approved", approvedAt: new Date(), approvedByUserId: user.id, updatedAt: new Date() })
    .where(and(inArray(schema.messageDrafts.leadStateId, ids), eq(schema.messageDrafts.status, "drafted")));
  for (const id of ids) await releaseIfApproved(id);
  revalidatePath("/message-review");
}

/** Sends an approved, unsent lead back to review. */
export async function unapproveLead(fd: FormData) {
  await requireUser();
  const id = String(fd.get("leadStateId"));
  if (!isId(id)) return;
  await db
    .update(schema.messageDrafts)
    .set({ status: "drafted", approvedAt: null, approvedByUserId: null, updatedAt: new Date() })
    .where(and(eq(schema.messageDrafts.leadStateId, id), eq(schema.messageDrafts.status, "approved")));
  revalidatePath("/message-review");
}

export async function saveDraft(draftId: string, body: string): Promise<{ ok?: boolean; warnings?: string[]; error?: string }> {
  await requireUser();
  if (!isId(draftId)) return { error: "Draft not found." };
  const text = body.trim().slice(0, 3000);
  if (!text) return { error: "A message cannot be empty." };
  const [row] = await db
    .select({ d: schema.messageDrafts, c: schema.campaigns, p: schema.products })
    .from(schema.messageDrafts)
    .innerJoin(schema.leadState, eq(schema.leadState.id, schema.messageDrafts.leadStateId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
    .leftJoin(schema.products, eq(schema.products.id, schema.campaigns.productId))
    .where(eq(schema.messageDrafts.id, draftId));
  if (!row) return { error: "Draft not found." };
  if (!["drafted", "approved"].includes(row.d.status)) return { error: "This message has already been sent and cannot change." };
  const role = messageSteps(row.c).find((m) => m.stepIndex === row.d.stepIndex)?.role ?? "follow_up";
  const warnings = row.p ? checkMessage(role, text, row.p) : [];
  await db.update(schema.messageDrafts).set({ body: text, warnings, updatedAt: new Date() }).where(eq(schema.messageDrafts.id, draftId));
  revalidatePath("/message-review");
  return { ok: true, warnings };
}

export async function regenerateLead(leadStateId: string, instruction: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  if (!isId(leadStateId)) return { error: "Lead not found." };
  try {
    const outcome = await generateDrafts(leadStateId, { regenerate: true, instruction: instruction.trim() || undefined, userId: user.id });
    if (outcome === "busy") return { error: "This lead is being drafted right now. Try again in a moment." };
    if (outcome === "error") {
      const [s] = await db.select({ e: schema.leadState.draftError }).from(schema.leadState).where(eq(schema.leadState.id, leadStateId));
      return { error: s?.e ?? "Drafting failed." };
    }
    if (outcome !== "drafted") return { error: "Nothing left to draft for this lead." };
  } catch (e) {
    console.error(e);
    return { error: friendlyAiError(e) };
  }
  revalidatePath("/message-review");
  return { ok: true };
}

export async function excludeFromReview(fd: FormData) {
  await requireUser();
  const id = String(fd.get("leadStateId"));
  if (!isId(id)) return;
  await db
    .update(schema.leadState)
    .set({ status: "excluded", waiting: null, nextRunAt: null, note: "Excluded during review" })
    .where(and(eq(schema.leadState.id, id), inArray(schema.leadState.status, ["pending", "active"])));
  await db
    .update(schema.messageDrafts)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(schema.messageDrafts.leadStateId, id), inArray(schema.messageDrafts.status, ["drafted", "approved"])));
  revalidatePath("/message-review");
}

/** Feedback on a lead's drafts becomes proposed rules for the campaign's writing style. */
export async function proposeRulesFromReview(leadStateId: string, feedback: string): Promise<{ rules?: RuleSet; styleId?: string; error?: string }> {
  const user = await requireUser();
  if (!isId(leadStateId) || !feedback.trim()) return { error: "Write some feedback first." };
  const [row] = await db
    .select({ c: schema.campaigns, st: schema.writingStyles })
    .from(schema.leadState)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
    .leftJoin(schema.writingStyles, eq(schema.writingStyles.id, schema.campaigns.writingStyleId))
    .where(eq(schema.leadState.id, leadStateId));
  if (!row?.st) return { error: "This campaign has no writing style to teach." };
  const drafts = await db
    .select()
    .from(schema.messageDrafts)
    .where(and(eq(schema.messageDrafts.leadStateId, leadStateId), inArray(schema.messageDrafts.status, ["drafted", "approved"])));
  if (!drafts.length) return { error: "There are no unsent drafts to give feedback on." };
  try {
    const rules = await proposeRules({
      style: row.st.rules,
      feedback: [{ step: "whole sequence", message: drafts.map((d) => d.body).join("\n\n---\n\n"), feedback: feedback.slice(0, 1000) }],
      userId: user.id,
    });
    return { rules, styleId: row.st.id };
  } catch (e) {
    console.error(e);
    return { error: friendlyAiError(e) };
  }
}
