import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Campaign, Lead } from "@/db/schema";
import { AiNotConfiguredError, AiOutputError, friendlyAiError } from "./ai";
import { playbookById } from "./campaigns/playbooks";
import { renderTemplate } from "./campaigns/template";
import { draftMessages, rolesFor } from "./voice/compose";
import type { PlanItem, Prospect } from "./voice/compose";

/** Message steps of a campaign (every step after the connection request), with their roles. */
export function messageSteps(c: Campaign) {
  const idx = c.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.type === "message");
  const roles = rolesFor(idx.length);
  return idx.map(({ s, i }, k) => ({ step: s, stepIndex: i, role: roles[k] }));
}

export const hasAiSteps = (c: Campaign) => c.steps.some((s) => s.type === "message" && s.mode === "ai");

export function prospectOf(lead: Lead): Prospect {
  const profile = (lead.profile ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    firstName: lead.firstName,
    lastName: lead.lastName || undefined,
    title: lead.title ?? undefined,
    company: lead.company ?? undefined,
    headline: lead.headline ?? str(profile.headline),
    location: lead.location ?? str(profile.location),
    industry: lead.industry ?? undefined,
    about: str(profile.summary),
  };
}

const UNSENT = ["drafted", "approved"] as const;

export type DraftOutcome = "drafted" | "exists" | "nothing" | "busy" | "skipped" | "error";

/**
 * Drafts the unsent AI messages for one lead in a campaign.
 * With `regenerate`, replaces existing unsent drafts (optionally following an instruction).
 */
export async function generateDrafts(
  leadStateId: string,
  opts: { regenerate?: boolean; instruction?: string; userId?: string | null } = {},
): Promise<DraftOutcome> {
  // One drafting run per lead at a time. The lock belongs to this transaction, so it is
  // released when the transaction ends, whatever happens; the work itself uses other
  // connections from the pool.
  return db.transaction(async (lockTx) => {
    const [{ ok }] = await lockTx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${leadStateId})) as ok`);
    if (!ok) return "busy" as const;
    return draftLocked(leadStateId, opts);
  });
}

async function draftLocked(
  leadStateId: string,
  opts: { regenerate?: boolean; instruction?: string; userId?: string | null },
): Promise<DraftOutcome> {
  {
    const [row] = await db
      .select({ s: schema.leadState, c: schema.campaigns, lead: schema.leads })
      .from(schema.leadState)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
      .where(eq(schema.leadState.id, leadStateId));
    if (!row || !["pending", "active"].includes(row.s.status)) return "skipped";
    const { s, c, lead } = row;
    if (!hasAiSteps(c)) return "nothing";

    const fail = async (message: string) => {
      await db.update(schema.leadState).set({ draftError: message }).where(eq(schema.leadState.id, s.id));
      return "error" as const;
    };
    const [product] = c.productId ? await db.select().from(schema.products).where(eq(schema.products.id, c.productId)) : [];
    const [style] = c.writingStyleId ? await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, c.writingStyleId)) : [];
    if (!product || !style) return fail("The campaign needs a product and a writing style before messages can be drafted.");

    const drafts = await db.select().from(schema.messageDrafts).where(eq(schema.messageDrafts.leadStateId, s.id));
    const sentAt = (i: number) => drafts.find((d) => d.stepIndex === i && d.status === "sent");
    const unsentAt = (i: number) => drafts.find((d) => d.stepIndex === i && (UNSENT as readonly string[]).includes(d.status));

    const vars = { first_name: lead.firstName, last_name: lead.lastName, company: lead.company, title: lead.title };
    const plan: PlanItem[] = messageSteps(c).map(({ step, stepIndex, role }) => {
      const base = { stepIndex, role, waitDays: step.waitDays };
      if (stepIndex < s.stepIndex) {
        const text = sentAt(stepIndex)?.body ?? (step.mode === "template" ? renderTemplate(step.template, step.fallback, vars) : null);
        return { ...base, kind: "sent", text: text ?? "(sent earlier)" };
      }
      if (step.mode === "template") return { ...base, kind: "fixed", text: renderTemplate(step.template, step.fallback, vars) ?? "(skipped for this lead)" };
      return { ...base, kind: "write" };
    });
    const toWrite = plan.filter((m) => m.kind === "write");
    if (!toWrite.length) return "nothing";
    if (!opts.regenerate && toWrite.every((m) => unsentAt(m.stepIndex))) return "exists";

    let result;
    try {
      result = await draftMessages({
        style: style.rules,
        product,
        prospect: prospectOf(lead),
        plan,
        playbookBrief: playbookById(c.playbook).brief || undefined,
        instruction: opts.instruction,
        userId: opts.userId ?? null,
        feature: opts.regenerate ? "review.regenerate" : "campaign.draft",
      });
    } catch (e) {
      if (e instanceof AiNotConfiguredError || e instanceof AiOutputError) return fail(e.message);
      await fail(friendlyAiError(e));
      throw e; // temporary problem: let the queue retry
    }

    const auto = c.approvalMode === "auto";
    const now = new Date();
    let allApproved = true;
    await db.transaction(async (tx) => {
      const steps = toWrite.map((m) => m.stepIndex);
      await tx
        .update(schema.messageDrafts)
        .set({ status: "discarded", updatedAt: now })
        .where(and(eq(schema.messageDrafts.leadStateId, s.id), inArray(schema.messageDrafts.stepIndex, steps), inArray(schema.messageDrafts.status, [...UNSENT])));
      for (const m of toWrite) {
        const body = result.bodies.get(m.stepIndex) ?? "";
        const warnings = result.warnings.get(m.stepIndex) ?? [];
        const approve = auto && warnings.length === 0 && body.length > 0;
        if (!approve) allApproved = false;
        const version = drafts.filter((d) => d.stepIndex === m.stepIndex).length + 1;
        await tx.insert(schema.messageDrafts).values({
          leadStateId: s.id,
          stepIndex: m.stepIndex,
          body,
          warnings,
          version,
          status: approve ? "approved" : "drafted",
          approvedAt: approve ? now : null,
        });
      }
      await tx
        .update(schema.leadState)
        .set({
          fitScore: result.fitScore,
          fitReason: result.fitReason,
          angle: result.angle,
          draftedAt: now,
          draftError: null,
          // A lead the engine was holding for approval can go as soon as everything is approved.
          ...(allApproved && s.waiting === "approval" ? { waiting: null, nextRunAt: now, note: "Drafts approved automatically" } : {}),
          ...(!allApproved && s.waiting === "approval" ? { note: "Drafts ready for review" } : {}),
        })
        .where(eq(schema.leadState.id, s.id));
    });
    return "drafted";
  }
}
