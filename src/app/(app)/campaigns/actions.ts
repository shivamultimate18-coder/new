"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { Campaign, SequenceStep } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import { enrollLeads } from "@/lib/campaigns/enroll";
import { LIMITS, MAX_MESSAGE_STEPS } from "@/lib/campaigns/limits";
import { PLAYBOOKS, defaultSteps } from "@/lib/campaigns/playbooks";
import { readiness } from "@/lib/campaigns/readiness";
import { usableAccounts } from "@/lib/permissions";


const canManage = (u: CurrentUser, c: { createdByUserId: string | null }) =>
  u.role === "admin" || c.createdByUserId === u.id;

async function load(id: string) {
  const user = await requireUser();
  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c || !canManage(user, c)) return null;
  return { user, c };
}

export async function createCampaign() {
  const user = await requireUser();
  const [c] = await db
    .insert(schema.campaigns)
    .values({ name: "New campaign", createdByUserId: user.id, playbook: "curiosity", steps: defaultSteps("curiosity") })
    .returning();
  redirect(`/campaigns/${c.id}/edit`);
}

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter times as HH:MM.");
const Step = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["invite", "message"]),
  waitDays: z.number().int().min(0, "Wait days cannot be negative.").max(30, "Wait at most 30 days between steps."),
  mode: z.enum(["blank", "ai", "template"]),
  template: z.string().max(3000, "A message template is too long."),
  fallback: z.string().max(3000, "A fallback message is too long."),
});
const Payload = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(200),
  productId: z.string().uuid().nullable(),
  writingStyleId: z.string().uuid().nullable(),
  leadListId: z.string().uuid().nullable(),
  playbook: z.enum(PLAYBOOKS.map((p) => p.id) as [string, ...string[]]),
  steps: z.array(Step).max(MAX_MESSAGE_STEPS + 1, `Use at most ${MAX_MESSAGE_STEPS} messages.`),
  accountIds: z.array(z.string().uuid()).max(200),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown timezone."),
  activeDays: z.array(z.number().int().min(0).max(6)).max(7),
  activeFrom: Time,
  activeTo: Time,
  dailyInviteLimit: z
    .number({ message: "Enter a number of connection requests per day." })
    .int("Connection requests per day must be a whole number.")
    .min(1, "Send at least 1 connection request per day.")
    .max(LIMITS.invites, `Connection requests are capped at ${LIMITS.invites} per account per day to keep accounts safe.`),
  dailyMessageLimit: z
    .number({ message: "Enter a number of messages per day." })
    .int("Messages per day must be a whole number.")
    .min(1, "Send at least 1 message per day.")
    .max(LIMITS.messages, `Messages are capped at ${LIMITS.messages} per account per day.`),
});
export type CampaignPayload = z.infer<typeof Payload>;

/** Compares field by field: Postgres jsonb does not keep key order, so JSON strings differ. */
function sameSteps(a: SequenceStep[], b: SequenceStep[]) {
  const key = (s: SequenceStep) => [s.id, s.type, s.waitDays, s.mode, s.template, s.fallback].join("\u0000");
  return a.length === b.length && a.every((s, i) => key(s) === key(b[i]));
}

export async function saveCampaign(id: string, input: CampaignPayload): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await load(id);
  if (!ctx) return { error: "Campaign not found." };
  const { user, c } = ctx;
  const parsed = Payload.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some settings are invalid." };
  const p = parsed.data;

  // Steps: invite first, then messages; invites cannot use AI, messages cannot be blank.
  if (p.steps.length && (p.steps[0].type !== "invite" || p.steps.slice(1).some((s) => s.type !== "message"))) {
    return { error: "The sequence must be one connection request followed by messages." };
  }
  if (p.steps[0] && p.steps[0].mode === "ai") return { error: "Connection notes are blank or a template." };
  if (p.steps.slice(1).some((s) => s.mode === "blank")) return { error: "Messages must be drafted by AI or use a template." };

  // Fields that may change only before launch.
  const locked = c.status !== "draft";
  if (locked) {
    if (p.leadListId !== c.leadListId) return { error: "The lead list cannot change after launch. Duplicate the campaign instead." };
    if (!sameSteps(p.steps, c.steps)) {
      return { error: "The sequence cannot change after launch. Duplicate the campaign instead." };
    }
  }

  // Accounts: admins may use any; members only their own. Keep accounts already on the
  // campaign that this person cannot see (another member's), rather than silently dropping them.
  const allowed = new Set((await usableAccounts(user)).map((a) => a.id));
  const existing = await db
    .select({ accountId: schema.campaignAccounts.accountId })
    .from(schema.campaignAccounts)
    .where(eq(schema.campaignAccounts.campaignId, id));
  const invalid = p.accountIds.filter((a) => !allowed.has(a) && !existing.some((e) => e.accountId === a));
  if (invalid.length) return { error: "You can only add LinkedIn accounts you are allowed to use." };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.campaigns)
      .set({
        name: p.name,
        productId: p.productId,
        writingStyleId: p.writingStyleId,
        leadListId: p.leadListId,
        playbook: p.playbook,
        steps: p.steps,
        timezone: p.timezone,
        activeDays: [...new Set(p.activeDays)].sort(),
        activeFrom: p.activeFrom,
        activeTo: p.activeTo,
        dailyInviteLimit: p.dailyInviteLimit,
        dailyMessageLimit: p.dailyMessageLimit,
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, id));
    await tx.delete(schema.campaignAccounts).where(eq(schema.campaignAccounts.campaignId, id));
    const ids = [...new Set(p.accountIds)];
    if (ids.length) await tx.insert(schema.campaignAccounts).values(ids.map((accountId) => ({ campaignId: id, accountId })));
  });
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true };
}

export async function launchCampaign(fd: FormData) {
  const ctx = await load(String(fd.get("id")));
  if (!ctx || ctx.c.status !== "draft") return;
  const checks = await readiness(ctx.c);
  if (checks.some((x) => !x.ok)) redirect(`/campaigns/${ctx.c.id}?error=not-ready`);
  await enrollLeads(ctx.c.id, ctx.c.leadListId!);
  await db
    .update(schema.campaigns)
    .set({ status: "running", launchedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.campaigns.id, ctx.c.id), eq(schema.campaigns.status, "draft")));
  revalidatePath(`/campaigns/${ctx.c.id}`);
  revalidatePath("/campaigns");
}

export async function setPaused(fd: FormData) {
  const ctx = await load(String(fd.get("id")));
  if (!ctx) return;
  const pause = fd.get("pause") === "1";
  const from: Campaign["status"] = pause ? "running" : "paused";
  if (ctx.c.status !== from) return;
  if (!pause) {
    // Resuming re-checks everything except the sequence, which is fixed after launch.
    const checks = await readiness(ctx.c);
    if (checks.some((x) => !x.ok && x.id !== "list")) redirect(`/campaigns/${ctx.c.id}?error=not-ready`);
  }
  await db
    .update(schema.campaigns)
    .set({ status: pause ? "paused" : "running", updatedAt: new Date() })
    .where(eq(schema.campaigns.id, ctx.c.id));
  revalidatePath(`/campaigns/${ctx.c.id}`);
  revalidatePath("/campaigns");
}

export async function duplicateCampaign(fd: FormData) {
  const ctx = await load(String(fd.get("id")));
  if (!ctx) return;
  const { c, user } = ctx;
  const [copy] = await db
    .insert(schema.campaigns)
    .values({
      name: `${c.name} (copy)`,
      productId: c.productId,
      writingStyleId: c.writingStyleId,
      leadListId: c.leadListId,
      playbook: c.playbook,
      steps: c.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
      timezone: c.timezone,
      activeDays: c.activeDays,
      activeFrom: c.activeFrom,
      activeTo: c.activeTo,
      dailyInviteLimit: c.dailyInviteLimit,
      dailyMessageLimit: c.dailyMessageLimit,
      createdByUserId: user.id,
    })
    .returning();
  const links = await db.select().from(schema.campaignAccounts).where(eq(schema.campaignAccounts.campaignId, c.id));
  if (links.length) await db.insert(schema.campaignAccounts).values(links.map((l) => ({ campaignId: copy.id, accountId: l.accountId })));
  redirect(`/campaigns/${copy.id}/edit`);
}

export async function deleteCampaign(fd: FormData) {
  const ctx = await load(String(fd.get("id")));
  if (!ctx || ctx.c.status === "running") return;
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, ctx.c.id));
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function excludeLeads(fd: FormData) {
  const ctx = await load(String(fd.get("id")));
  if (!ctx) return;
  const ids = fd.getAll("leadStateId").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return;
  await db
    .update(schema.leadState)
    .set({ status: "excluded", nextRunAt: null, note: "Excluded by a teammate" })
    .where(
      and(
        eq(schema.leadState.campaignId, ctx.c.id),
        inArray(schema.leadState.id, ids),
        inArray(schema.leadState.status, ["pending", "active"]),
      ),
    );
  revalidatePath(`/campaigns/${ctx.c.id}`);
}
