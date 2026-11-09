import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Account, Campaign, Lead } from "@/db/schema";
import { renderTemplate } from "../campaigns/template";
import { AiBudgetError, assertAiBudget } from "../budget";
import { hasAiSteps } from "../drafting";
import { recordMessage, upsertConversation } from "../inbox";
import { isSuppressed } from "../suppression";
import { enqueueDraft } from "../queue";
import { env } from "../env";
import {
  UnipileError,
  getProfile,
  recentChatMessages,
  recentRelations,
  sendInvite,
  sendMessage,
} from "../unipile";
import { between, inWindow, startOfLocalDay } from "./window";

/**
 * The sending engine (plan section 5, "Account safety rules").
 *
 * Every tick, each usable account takes at most one LinkedIn action, then waits a random
 * gap. Follow-up messages go before new invites. Nothing is sent outside a campaign's
 * window or over any limit, a lead is pinned to one account, any reply stops the lead's
 * sequence, and an account-level error pauses the account instead of retrying.
 */

export const SAFETY = {
  maxInvitesPerDay: 15,
  maxMessagesPerDay: 40,
  invitesPerWeek: 75,
  actionsPerDay: 120,
  inviteExpiryDays: 21,
  warmupEveryDays: 2,
  transientErrorsBeforePause: 3,
} as const;

const MOCK = () => env.UNIPILE_MOCK;
/**
 * In mock mode a "day" lasts MOCK_DAY_SECONDS (default 10) so a whole sequence can be
 * watched in a few minutes.
 */
export const dayMs = () => (MOCK() ? Number(process.env.MOCK_DAY_SECONDS || 10) * 1000 : 24 * 3600 * 1000);
const gapMs = () => (MOCK() ? between(2_000, 5_000) : between(4 * 60_000, 11 * 60_000));
const relationsEveryMs = () => (MOCK() ? 3_000 : 2 * 3600 * 1000);
const LOCK_MS = 10 * 60_000;

type Kind = "invite.sent" | "message.sent" | "profile.lookup";

async function log(accountId: string, type: string, detail: Record<string, unknown>) {
  await db.insert(schema.activityLog).values({ accountId, type, detail });
}

async function countSince(accountId: string, types: Kind[], since: Date, campaignId?: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.accountId, accountId),
        inArray(schema.activityLog.type, types),
        gte(schema.activityLog.at, since),
        campaignId ? sql`${schema.activityLog.detail}->>'campaignId' = ${campaignId}` : undefined,
      ),
    );
  return n;
}

/** Queues AI drafting for a lead. A failure here must not stop sending. */
async function requestDrafts(leadStateId: string) {
  try {
    await enqueueDraft(leadStateId);
  } catch (e) {
    console.error(`[engine] could not queue drafting for ${leadStateId}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Lead state transitions

async function release(leadStateId: string, patch: Partial<typeof schema.leadState.$inferInsert> = {}) {
  await db.update(schema.leadState).set({ lockedUntil: null, ...patch }).where(eq(schema.leadState.id, leadStateId));
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

export async function markAccepted(leadStateId: string) {
  const [row] = await db
    .select({ s: schema.leadState, c: schema.campaigns })
    .from(schema.leadState)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
    .where(eq(schema.leadState.id, leadStateId));
  if (!row || row.s.waiting !== "acceptance") return;
  const step = row.c.steps[row.s.stepIndex];
  const next = new Date(Date.now() + (step?.waitDays ?? 0) * dayMs());
  await db
    .update(schema.leadState)
    .set({
      waiting: null,
      acceptedAt: new Date(),
      nextRunAt: next,
      ...(step ? { note: `Accepted. Next message from ${fmtDate(next)}` } : { status: "completed", note: "Accepted. No messages in the sequence" }),
    })
    .where(eq(schema.leadState.id, leadStateId));
  if (row.s.accountId) await log(row.s.accountId, "invite.accepted", { campaignId: row.c.id, leadStateId });
  // Draft after acceptance (plan section 4): only accepted leads cost a full sequence.
  if (step && hasAiSteps(row.c)) await requestDrafts(leadStateId);
}

export async function markReplied(leadStateId: string) {
  const [s] = await db.select().from(schema.leadState).where(eq(schema.leadState.id, leadStateId));
  if (!s || !["active", "pending"].includes(s.status)) return;
  await db
    .update(schema.leadState)
    .set({ status: "replied", repliedAt: new Date(), waiting: null, nextRunAt: null, lockedUntil: null, note: "Replied. Remaining messages cancelled" })
    .where(eq(schema.leadState.id, leadStateId));
  // Any draft not yet sent is no longer needed.
  await db
    .update(schema.messageDrafts)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(schema.messageDrafts.leadStateId, leadStateId), inArray(schema.messageDrafts.status, ["drafted", "approved"])));
  if (s.accountId) await log(s.accountId, "lead.replied", { campaignId: s.campaignId, leadStateId });
}

/** Moves a lead past a message step: schedules the next one or completes the sequence. */
async function advance(leadStateId: string, c: Campaign, fromIndex: number, extra: Partial<typeof schema.leadState.$inferInsert> = {}) {
  const next = fromIndex + 1;
  if (next >= c.steps.length) {
    await release(leadStateId, { ...extra, status: "completed", stepIndex: next, nextRunAt: null, waiting: null, note: "Sequence finished" });
    return;
  }
  const at = new Date(Date.now() + c.steps[next].waitDays * dayMs());
  await release(leadStateId, { ...extra, stepIndex: next, nextRunAt: at, waiting: null, note: `Next message from ${fmtDate(at)}` });
}

// ---------------------------------------------------------------------------
// Errors

type ErrorKind = "lead" | "account" | "transient" | "already-invited" | "already-connected";

export function classifyError(e: unknown): ErrorKind {
  if (!(e instanceof UnipileError)) return "transient";
  const t = e.type.toLowerCase();
  if (/already_connected|first_degree/.test(t)) return "already-connected";
  if (/already_invited|cannot_resend|invitation_pending/.test(t)) return "already-invited";
  if (e.status === 401 || e.status === 403 || e.status === 429) return "account";
  if (/disconnected|credential|checkpoint|captcha|restricted|limit|quota|too_many|banned|suspended/.test(t)) return "account";
  if (e.status === 404 || /not_found|cannot_be_reached|not_allowed|invalid_recipient|blocked|unprocessable/.test(t)) return "lead";
  if (e.status === 400 || e.status === 422) return "lead";
  return "transient";
}

export async function pauseAccount(a: Account, reason: string) {
  await db
    .update(schema.accounts)
    .set({ enabled: false, pausedReason: reason, lastErrorAt: new Date() })
    .where(eq(schema.accounts.id, a.id));
  await log(a.id, "account.paused", { reason });
  console.warn(`[engine] paused account ${a.id}: ${reason}`);
}

const shortError = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);

// ---------------------------------------------------------------------------
// Mock LinkedIn (UNIPILE_MOCK=1): deterministic outcomes per lead, for local testing.

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const mock = {
  profile: (lead: Lead) => {
    // Test hooks: these first names make the mock fail the way LinkedIn can.
    if (lead.firstName === "FailAccount") throw new UnipileError(403, "errors/disconnected_account", "Mock: account disconnected");
    if (lead.firstName === "FailLead") throw new UnipileError(404, "errors/resource_not_found", "Mock: profile not found");
    return mock.profileOk(lead);
  },
  profileOk: (lead: Lead) => ({
    details: { headline: lead.headline, summary: `Mock profile summary for ${lead.firstName}.`, location: lead.location },
    providerId: lead.linkedinId ?? `MOCKP-${lead.publicIdentifier}`,
    publicIdentifier: lead.publicIdentifier,
    networkDistance: hash(lead.id) % 10 === 9 ? "FIRST_DEGREE" : "SECOND_DEGREE",
    invitePending: false,
  }),
  accepts: (leadId: string) => hash(leadId) % 10 < 7,
  replies: (leadId: string) => hash(leadId + "r") % 4 === 0,
  replyText: (leadId: string) =>
    [
      "Sounds interesting. Can you send me more details?",
      "Maybe next quarter, we are busy right now.",
      "Not interested, thanks.",
      "We actually offer the same services. Would you like a demo of ours?",
      "Please contact my assistant about this, she handles vendors.",
    ][hash(leadId + "t") % 5],
};

// ---------------------------------------------------------------------------
// Actions

type Ctx = { a: Account; c: Campaign; s: typeof schema.leadState.$inferSelect; lead: Lead };

async function ensureProfile({ a, lead, c, s }: Ctx) {
  const identifier = lead.providerId ?? lead.publicIdentifier ?? lead.linkedinId;
  if (!identifier) throw new UnipileError(404, "errors/no_identifier", "Lead has no LinkedIn identifier");
  const p = MOCK() ? mock.profile(lead) : await getProfile(a.unipileAccountId!, identifier);
  await log(a.id, "profile.lookup", { campaignId: c.id, leadStateId: s.id });
  await db
    .update(schema.leads)
    .set({ providerId: p.providerId, profile: p.details, ...(!lead.publicIdentifier && p.publicIdentifier ? { publicIdentifier: p.publicIdentifier.toLowerCase() } : {}) })
    .where(eq(schema.leads.id, lead.id));
  return p;
}

/** Returns true when a LinkedIn action was taken. */
async function doInvite(ctx: Ctx): Promise<boolean> {
  const { a, c, s, lead } = ctx;
  const profile = await ensureProfile(ctx);
  const base = { inviteSentAt: new Date(), lastActionAt: new Date(), stepIndex: 1, status: "active" as const };

  // The lookup gives the real member id, which catches the same person imported in another
  // format (Sales Navigator id, profile slug, CSV) after enrollment.
  if (await isSuppressed({ linkedinId: lead.linkedinId, publicIdentifier: lead.publicIdentifier ?? profile.publicIdentifier, providerId: profile.providerId })) {
    await release(s.id, { status: "skipped", note: "On the do-not-contact list" });
    return true;
  }
  // Check and claim in one locked step, so two accounts can never both invite this person.
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"invite:" + profile.providerId}))`);
    const [other] = await tx
      .select({ id: schema.leadState.id })
      .from(schema.leadState)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
      .where(
        and(
          eq(schema.leads.providerId, profile.providerId),
          sql`${schema.leadState.id} <> ${s.id}`,
          or(
            sql`${schema.leadState.inviteSentAt} is not null`,
            sql`${schema.leadState.acceptedAt} is not null`,
            inArray(schema.leadState.status, ["active", "completed", "replied"]),
          ),
        ),
      )
      .limit(1);
    if (other) return false;
    await tx.update(schema.leadState).set({ inviteSentAt: new Date() }).where(eq(schema.leadState.id, s.id));
    return true;
  });
  if (!claimed) {
    await release(s.id, { status: "skipped", note: "Already contacted by another campaign" });
    return true;
  }

  if (profile.networkDistance === "FIRST_DEGREE") {
    const step = c.steps[1];
    const at = new Date(Date.now() + (step?.waitDays ?? 0) * dayMs());
    await release(s.id, { ...base, inviteSentAt: null, acceptedAt: new Date(), waiting: null, nextRunAt: at, note: "Already connected. Skipped the invite" });
    if (hasAiSteps(c)) await requestDrafts(s.id);
    return true;
  }
  if (!profile.invitePending) {
    const invite = c.steps[0];
    let note: string | null = null;
    if (invite.mode === "template" && a.hasSalesNav) {
      note = renderTemplate(invite.template, invite.fallback, { first_name: lead.firstName, last_name: lead.lastName, company: lead.company, title: lead.title });
      if (note === null) {
        await release(s.id, { status: "skipped", note: "Connection note needs details this lead does not have" });
        return true;
      }
    }
    if (!MOCK()) await sendInvite(a.unipileAccountId!, profile.providerId, note);
  }
  await log(a.id, "invite.sent", { campaignId: c.id, leadStateId: s.id });
  await release(s.id, { ...base, waiting: "acceptance", note: "Invite sent. Waiting for acceptance" });
  return true;
}

async function doMessage(ctx: Ctx): Promise<boolean> {
  const { a, c, s, lead } = ctx;
  const step = c.steps[s.stepIndex];
  if (!step) {
    await release(s.id, { status: "completed", nextRunAt: null, note: "Sequence finished" });
    return false;
  }
  if (await isSuppressed({ linkedinId: lead.linkedinId, publicIdentifier: lead.publicIdentifier, providerId: lead.providerId })) {
    await release(s.id, { status: "excluded", nextRunAt: null, waiting: null, note: "On the do-not-contact list" });
    return false;
  }

  // Never message someone who has replied, even if the webhook was missed.
  if (s.chatId) {
    if (MOCK()) {
      if (mock.replies(lead.id)) {
        // The mock prospect "replies" the way the webhook would deliver it.
        await handleIncomingMessage(a.unipileAccountId!, s.chatId, lead.providerId, { text: mock.replyText(lead.id), externalId: `mock-${s.id}` });
        return false;
      }
    } else {
      // Only messages after the connection was made count: an existing chat can hold older
      // history from the prospect that is not a reply to this campaign.
      const since = (s.acceptedAt ?? s.inviteSentAt ?? s.enrolledAt).getTime();
      const recent = await recentChatMessages(s.chatId);
      const theirs = recent.filter((m) => {
        if (!m.fromProspect) return false;
        const at = Date.parse(m.at);
        return Number.isNaN(at) || at > since; // an undated message is treated as a reply, to be safe
      });
      if (theirs.length) {
        // Store what the webhook missed, then stop the sequence.
        for (const m of theirs) await handleIncomingMessage(a.unipileAccountId!, s.chatId, lead.providerId, { text: m.text, externalId: m.id, at: m.at, fromAccount: false });
        await markReplied(s.id);
        return false;
      }
    }
  }

  let text: string | null;
  let draftId: string | null = null;
  if (step.mode === "ai") {
    const [draft] = await db
      .select()
      .from(schema.messageDrafts)
      .where(and(eq(schema.messageDrafts.leadStateId, s.id), eq(schema.messageDrafts.stepIndex, s.stepIndex), eq(schema.messageDrafts.status, "approved")))
      .limit(1);
    if (!draft) {
      const [pending] = await db
        .select({ id: schema.messageDrafts.id })
        .from(schema.messageDrafts)
        .where(and(eq(schema.messageDrafts.leadStateId, s.id), eq(schema.messageDrafts.stepIndex, s.stepIndex), eq(schema.messageDrafts.status, "drafted")))
        .limit(1);
      await release(s.id, { waiting: "approval", note: pending ? "Drafts ready for review" : "Drafting messages" });
      // Backup for drafting that never happened (or failed): ask again.
      if (!pending) await requestDrafts(s.id);
      return false;
    }
    text = draft.body;
    draftId = draft.id;
  } else {
    text = renderTemplate(step.template, step.fallback, { first_name: lead.firstName, last_name: lead.lastName, company: lead.company, title: lead.title });
    if (text === null) {
      // No usable text for this lead at this step: skip the step, keep the sequence going.
      await advance(s.id, c, s.stepIndex);
      return false;
    }
  }

  const providerId = lead.providerId ?? (await ensureProfile(ctx)).providerId;
  const sent = MOCK()
    ? { chatId: s.chatId ?? `mockchat-${s.id}`, messageId: `mockmsg-${s.id}-${s.stepIndex}` }
    : await sendMessage({ unipileAccountId: a.unipileAccountId!, providerId, chatId: s.chatId, text });
  const chatId = sent.chatId;
  await log(a.id, "message.sent", { campaignId: c.id, leadStateId: s.id, step: s.stepIndex });
  try {
    const conv = await upsertConversation({
      accountId: a.id,
      chatId,
      leadStateId: s.id,
      leadId: lead.id,
      prospectProviderId: providerId,
      prospectName: `${lead.firstName} ${lead.lastName}`.trim(),
      prospectHeadline: lead.headline,
      prospectProfileUrl: lead.profileUrl,
    });
    await recordMessage(conv, { direction: "out", body: text, source: "campaign", externalId: sent.messageId });
  } catch (e) {
    // The message went out; failing to file it in the inbox must not resend it.
    console.error(`[engine] sent but could not store message for ${s.id}:`, e);
  }
  if (draftId) {
    await db.update(schema.messageDrafts).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(schema.messageDrafts.id, draftId));
  }
  await advance(s.id, c, s.stepIndex, { chatId, lastActionAt: new Date() });
  return true;
}

// ---------------------------------------------------------------------------
// Picking work for one account

async function claim(where: ReturnType<typeof and>, assignTo?: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: schema.leadState.id })
      .from(schema.leadState)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
      .where(where)
      .orderBy(asc(schema.leadState.nextRunAt), asc(schema.leads.seq))
      .limit(1)
      .for("update", { skipLocked: true, of: schema.leadState });
    if (!row) return null;
    await tx
      .update(schema.leadState)
      .set({ lockedUntil: new Date(Date.now() + LOCK_MS), ...(assignTo ? { accountId: assignTo } : {}) })
      .where(eq(schema.leadState.id, row.id));
    return row.id;
  });
}

const unlocked = () => or(isNull(schema.leadState.lockedUntil), lt(schema.leadState.lockedUntil, new Date()));

export async function processAccount(a: Account): Promise<"acted" | "idle" | "outside-window" | "at-limit"> {
  const now = new Date();
  const campaigns = await db
    .select({ c: schema.campaigns })
    .from(schema.campaignAccounts)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignAccounts.campaignId))
    .where(and(eq(schema.campaignAccounts.accountId, a.id), eq(schema.campaigns.status, "running")));
  const open = campaigns.map((r) => r.c).filter((c) => inWindow(c, now));
  if (!open.length) return "outside-window";

  // Account-wide limits over rolling windows.
  const day = new Date(now.getTime() - dayMs());
  const week = new Date(now.getTime() - 7 * dayMs());
  const [invites24, messages24, actions24, invites7d] = await Promise.all([
    countSince(a.id, ["invite.sent"], day),
    countSince(a.id, ["message.sent"], day),
    countSince(a.id, ["invite.sent", "message.sent", "profile.lookup"], day),
    countSince(a.id, ["invite.sent"], week),
  ]);
  const actionsLeft = actions24 < SAFETY.actionsPerDay;
  const accountCanInvite = actionsLeft && invites24 < Math.min(a.dailyInviteLimit, SAFETY.maxInvitesPerDay) && invites7d < SAFETY.invitesPerWeek;
  const accountCanMessage = actionsLeft && messages24 < Math.min(a.dailyMessageLimit, SAFETY.maxMessagesPerDay);

  // Per-campaign daily limits, counted from the start of the campaign's local day.
  const invitable: { id: string; sent: number }[] = [];
  const messageCampaigns: string[] = [];
  for (const c of open) {
    const since = MOCK() ? day : startOfLocalDay(c.timezone, now);
    if (accountCanMessage && (await countSince(a.id, ["message.sent"], since, c.id)) < c.dailyMessageLimit) messageCampaigns.push(c.id);
    if (accountCanInvite) {
      const sent = await countSince(a.id, ["invite.sent"], since, c.id);
      if (sent < c.dailyInviteLimit) invitable.push({ id: c.id, sent });
    }
  }
  // Share invites fairly between campaigns: the one this account has invited for least today goes first.
  const inviteCampaigns = invitable.sort((x, y) => x.sent - y.sent || Math.random() - 0.5).map((x) => x.id);
  if (!inviteCampaigns.length && !messageCampaigns.length) return "at-limit";

  // Up to a few attempts: a lead waiting for approval or skipped costs no LinkedIn action.
  for (let attempt = 0; attempt < 5; attempt++) {
    let id: string | null = null;
    if (messageCampaigns.length) {
      id = await claim(
        and(
          eq(schema.leadState.accountId, a.id),
          inArray(schema.leadState.campaignId, messageCampaigns),
          eq(schema.leadState.status, "active"),
          isNull(schema.leadState.waiting),
          lte(schema.leadState.nextRunAt, now),
          unlocked(),
        ),
      );
    }
    for (const campaignId of inviteCampaigns) {
      if (id) break;
      id = await claim(
        and(
          eq(schema.leadState.campaignId, campaignId),
          eq(schema.leadState.status, "pending"),
          or(isNull(schema.leadState.accountId), eq(schema.leadState.accountId, a.id)),
          unlocked(),
        ),
        a.id,
      );
    }
    if (!id) return "idle";

    const [row] = await db
      .select({ s: schema.leadState, lead: schema.leads })
      .from(schema.leadState)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
      .where(eq(schema.leadState.id, id));
    const c = open.find((x) => x.id === row.s.campaignId)!;
    const ctx: Ctx = { a, c, s: row.s, lead: row.lead };

    try {
      const acted = row.s.status === "pending" ? await doInvite(ctx) : await doMessage(ctx);
      if (acted) {
        await db
          .update(schema.accounts)
          .set({ nextActionAt: new Date(Date.now() + gapMs()), lastActivityAt: new Date(), consecutiveErrors: 0 })
          .where(eq(schema.accounts.id, a.id));
        return "acted";
      }
    } catch (e) {
      const kind = classifyError(e);
      console.warn(`[engine] account ${a.id} lead ${row.s.id}: ${kind}: ${shortError(e)}`);
      if (kind === "already-invited" && row.s.status === "pending") {
        await log(a.id, "invite.sent", { campaignId: c.id, leadStateId: row.s.id, alreadyPending: true });
        await release(row.s.id, { status: "active", stepIndex: 1, waiting: "acceptance", inviteSentAt: new Date(), note: "Invite already pending. Waiting for acceptance" });
      } else if (kind === "already-connected" && row.s.status === "pending") {
        // The lookup was stale: treat as connected and go straight to the first message.
        const at = new Date(Date.now() + (c.steps[1]?.waitDays ?? 0) * dayMs());
        await release(row.s.id, { status: "active", stepIndex: 1, inviteSentAt: null, acceptedAt: new Date(), waiting: null, nextRunAt: at, note: "Already connected. Skipped the invite" });
        if (hasAiSteps(c)) await requestDrafts(row.s.id);
      } else if (kind === "lead") {
        await release(row.s.id, { status: "failed", note: `LinkedIn refused this lead: ${shortError(e).slice(0, 120)}` });
      } else if (kind === "account") {
        // Keep the lead on this account: if the lead itself somehow causes the error,
        // handing it on would pause every account in turn. It waits for this account.
        await release(row.s.id, { note: "Waiting: the sending account was paused", ...(row.s.status === "pending" ? { inviteSentAt: null } : {}) });
        await pauseAccount(a, `LinkedIn or Unipile reported a problem: ${shortError(e).slice(0, 160)}`);
        return "acted";
      } else {
        await release(row.s.id, row.s.status === "pending" ? { accountId: null, inviteSentAt: null } : {});
        const errors = a.consecutiveErrors + 1;
        if (errors >= SAFETY.transientErrorsBeforePause) {
          await pauseAccount(a, `${errors} errors in a row: ${shortError(e).slice(0, 160)}`);
        } else {
          await db
            .update(schema.accounts)
            .set({ consecutiveErrors: errors, lastErrorAt: new Date(), nextActionAt: new Date(Date.now() + (MOCK() ? 10_000 : 15 * 60_000)) })
            .where(eq(schema.accounts.id, a.id));
        }
        return "acted";
      }
      // Lead-level problems still used an API call: keep the gap.
      await db.update(schema.accounts).set({ nextActionAt: new Date(Date.now() + gapMs()) }).where(eq(schema.accounts.id, a.id));
      return "acted";
    }
  }
  return "idle";
}

// ---------------------------------------------------------------------------
// Acceptances, replies, housekeeping

export async function pollRelations(a: Account) {
  await db.update(schema.accounts).set({ relationsCheckedAt: new Date() }).where(eq(schema.accounts.id, a.id));
  const waiting = await db
    .select({ s: schema.leadState, lead: schema.leads })
    .from(schema.leadState)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
    .where(and(eq(schema.leadState.accountId, a.id), eq(schema.leadState.waiting, "acceptance")));
  if (!waiting.length) return;
  if (MOCK()) {
    for (const w of waiting) {
      if (w.s.inviteSentAt && Date.now() - w.s.inviteSentAt.getTime() > dayMs() / 2 && mock.accepts(w.lead.id)) await markAccepted(w.s.id);
    }
    return;
  }
  const relations = await recentRelations(a.unipileAccountId!);
  const ids = new Set(relations.map((r) => r.providerId).filter(Boolean));
  const slugs = new Set(relations.map((r) => r.publicIdentifier).filter(Boolean));
  for (const w of waiting) {
    if ((w.lead.providerId && ids.has(w.lead.providerId)) || (w.lead.publicIdentifier && slugs.has(w.lead.publicIdentifier))) {
      await markAccepted(w.s.id);
    }
  }
}

/** Webhook: a new connection on an account. */
export async function handleNewRelation(unipileAccountId: string, providerId: string | null, publicIdentifier: string | null) {
  const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.unipileAccountId, unipileAccountId));
  if (!a) return;
  const rows = await db
    .select({ id: schema.leadState.id })
    .from(schema.leadState)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
    .where(
      and(
        eq(schema.leadState.accountId, a.id),
        eq(schema.leadState.waiting, "acceptance"),
        or(
          providerId ? eq(schema.leads.providerId, providerId) : sql`false`,
          publicIdentifier ? eq(schema.leads.publicIdentifier, publicIdentifier.toLowerCase()) : sql`false`,
        ),
      ),
    );
  for (const r of rows) await markAccepted(r.id);
}

/**
 * A message arrived in a chat (webhook, or found before sending). It is filed in the Inbox;
 * if it came from a campaign lead, their sequence stops.
 */
export async function handleIncomingMessage(
  unipileAccountId: string,
  chatId: string,
  senderProviderId: string | null,
  m: { text: string; externalId?: string | null; at?: string | null; senderName?: string | null; fromAccount?: boolean | null },
) {
  const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.unipileAccountId, unipileAccountId));
  if (!a) return;
  // Find the campaign lead: by the chat first, then by who sent it.
  const byChat = await db
    .select({ s: schema.leadState, lead: schema.leads })
    .from(schema.leadState)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
    .where(and(eq(schema.leadState.accountId, a.id), eq(schema.leadState.chatId, chatId)))
    .limit(1);
  const bySender =
    byChat.length || !senderProviderId
      ? []
      : await db
          .select({ s: schema.leadState, lead: schema.leads })
          .from(schema.leadState)
          .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
          .where(and(eq(schema.leadState.accountId, a.id), eq(schema.leads.providerId, senderProviderId)))
          .limit(1);
  const match = byChat[0] ?? bySender[0];

  // Our own messages (sent from LinkedIn directly) also arrive here.
  const fromProspect =
    m.fromAccount === true
      ? false
      : m.fromAccount === false
        ? true
        : a.providerId && senderProviderId
          ? senderProviderId !== a.providerId
          : match
            ? senderProviderId === match.lead.providerId
            : true;

  const conv = await upsertConversation({
    accountId: a.id,
    chatId,
    leadStateId: match?.s.id,
    leadId: match?.lead.id,
    prospectProviderId: fromProspect ? senderProviderId : match?.lead.providerId,
    prospectName: match ? `${match.lead.firstName} ${match.lead.lastName}`.trim() : fromProspect ? m.senderName : null,
    prospectHeadline: match?.lead.headline,
    prospectProfileUrl: match?.lead.profileUrl,
  });
  const at = m.at ? new Date(m.at) : undefined;
  if (m.text.trim()) await recordMessage(conv, { direction: fromProspect ? "in" : "out", body: m.text, source: "linkedin", externalId: m.externalId, sentAt: at });

  if (fromProspect && match) {
    if (!match.s.chatId) await db.update(schema.leadState).set({ chatId }).where(eq(schema.leadState.id, match.s.id));
    await markReplied(match.s.id);
  }
}

let lastDraftRetry = 0;

/**
 * Leads held for approval whose drafting failed (no API key yet, budget used up, a refusal)
 * are asked again every 30 minutes, once the AI budget allows it.
 */
async function retryFailedDrafting() {
  if (Date.now() - lastDraftRetry < 30 * 60_000) return;
  lastDraftRetry = Date.now();
  try {
    await assertAiBudget();
  } catch (e) {
    if (e instanceof AiBudgetError) return;
    throw e;
  }
  const stuck = await db
    .select({ id: schema.leadState.id })
    .from(schema.leadState)
    .where(
      and(
        eq(schema.leadState.status, "active"),
        eq(schema.leadState.waiting, "approval"),
        sql`${schema.leadState.draftError} is not null`,
        sql`not exists (select 1 from message_drafts d where d.lead_state_id = ${schema.leadState.id} and d.step_index = ${schema.leadState.stepIndex} and d.status in ('drafted','approved'))`,
      ),
    )
    .limit(200);
  for (const r of stuck) {
    await db.update(schema.leadState).set({ draftError: null, note: "Drafting messages" }).where(eq(schema.leadState.id, r.id));
    await requestDrafts(r.id);
  }
}

async function housekeeping() {
  await retryFailedDrafting();
  // Invites nobody accepted.
  await db
    .update(schema.leadState)
    .set({ status: "completed", waiting: null, note: `Invite not accepted within ${SAFETY.inviteExpiryDays} days` })
    .where(
      and(
        eq(schema.leadState.waiting, "acceptance"),
        lt(schema.leadState.inviteSentAt, new Date(Date.now() - SAFETY.inviteExpiryDays * dayMs())),
      ),
    );
  // Running campaigns with nothing left to do.
  await db.execute(sql`
    update campaigns set status = 'completed', updated_at = now()
    where status = 'running' and launched_at is not null
      and not exists (select 1 from lead_state ls where ls.campaign_id = campaigns.id and ls.status in ('pending', 'active'))
  `);
  // Warm-up: raise limits slowly for accounts that sent invites cleanly.
  const since = new Date(Date.now() - SAFETY.warmupEveryDays * dayMs());
  const candidates = await db
    .select()
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.status, "ok"),
        eq(schema.accounts.enabled, true),
        lt(schema.accounts.dailyInviteLimit, SAFETY.maxInvitesPerDay),
        or(isNull(schema.accounts.warmupRaisedAt), lt(schema.accounts.warmupRaisedAt, since)),
        or(isNull(schema.accounts.lastErrorAt), lt(schema.accounts.lastErrorAt, since)),
        lt(schema.accounts.connectedAt, since),
      ),
    );
  for (const a of candidates) {
    if ((await countSince(a.id, ["invite.sent"], since)) === 0) continue;
    await db
      .update(schema.accounts)
      .set({
        dailyInviteLimit: Math.min(a.dailyInviteLimit + 1, SAFETY.maxInvitesPerDay),
        dailyMessageLimit: Math.min(a.dailyMessageLimit + 3, SAFETY.maxMessagesPerDay),
        warmupRaisedAt: new Date(),
      })
      .where(eq(schema.accounts.id, a.id));
    await log(a.id, "account.warmup", { invites: a.dailyInviteLimit + 1 });
  }
}

const ENGINE_LOCK = 4_242_002;
const CONCURRENCY = 6; // keeps the worker's database pool (10) from running dry

/** One pass over all accounts. Only one tick runs at a time across all workers. */
export async function tick(): Promise<{ ran: boolean; results?: Record<string, number> }> {
  return db.transaction(async (tx) => {
    const [{ ok }] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${ENGINE_LOCK}) as ok`);
    if (!ok) return { ran: false };
    await housekeeping();
    const accounts = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.status, "ok"), eq(schema.accounts.enabled, true)));
    const results: Record<string, number> = {};
    const queue = accounts.filter((a) => a.unipileAccountId);
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try {
          if (!a.relationsCheckedAt || Date.now() - a.relationsCheckedAt.getTime() > relationsEveryMs()) await pollRelations(a);
          if (a.nextActionAt && a.nextActionAt > new Date()) {
            results.waiting = (results.waiting ?? 0) + 1;
            continue;
          }
          const r = await processAccount(a);
          results[r] = (results[r] ?? 0) + 1;
        } catch (e) {
          console.error(`[engine] account ${a.id} failed:`, e);
          results.error = (results.error ?? 0) + 1;
        }
      }
    });
    await Promise.all(workers);
    return { ran: true, results };
  });
}
