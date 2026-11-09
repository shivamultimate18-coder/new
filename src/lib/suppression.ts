import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseProfileUrl } from "./linkedin";

/** Any LinkedIn identifiers we hold for a person. */
export type Ids = { linkedinId?: string | null; publicIdentifier?: string | null; providerId?: string | null };

const clean = (ids: Ids) => ({
  linkedinId: ids.linkedinId?.trim() || null,
  publicIdentifier: ids.publicIdentifier?.trim().toLowerCase() || null,
  providerId: ids.providerId?.trim() || null,
});

/** SQL condition: the lead row (alias with linkedin_id, public_identifier, provider_id) is on the list. */
export function suppressedSql(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`exists (select 1 from suppression_list x where
    (${a}.linkedin_id is not null and (x.linkedin_id = ${a}.linkedin_id or x.provider_id = ${a}.linkedin_id))
    or (${a}.public_identifier is not null and x.public_identifier = ${a}.public_identifier)
    or (${a}.provider_id is not null and (x.provider_id = ${a}.provider_id or x.linkedin_id = ${a}.provider_id)))`;
}

export async function isSuppressed(ids: Ids): Promise<boolean> {
  const c = clean(ids);
  const conds = [
    c.linkedinId ? or(eq(schema.suppressionList.linkedinId, c.linkedinId), eq(schema.suppressionList.providerId, c.linkedinId)) : undefined,
    c.publicIdentifier ? eq(schema.suppressionList.publicIdentifier, c.publicIdentifier) : undefined,
    c.providerId ? or(eq(schema.suppressionList.providerId, c.providerId), eq(schema.suppressionList.linkedinId, c.providerId)) : undefined,
  ].filter(Boolean);
  if (!conds.length) return false;
  const [row] = await db.select({ id: schema.suppressionList.id }).from(schema.suppressionList).where(or(...conds)).limit(1);
  return !!row;
}

/** Of the given leads (by index), which are on the list. One query for a whole batch. */
export async function suppressedIndexes(rows: Ids[]): Promise<Set<number>> {
  const ids = rows.map(clean);
  const lin = [...new Set(ids.flatMap((r) => [r.linkedinId, r.providerId]).filter((x): x is string => !!x))];
  const pub = [...new Set(ids.map((r) => r.publicIdentifier).filter((x): x is string => !!x))];
  if (!lin.length && !pub.length) return new Set();
  const hits = await db
    .select()
    .from(schema.suppressionList)
    .where(
      or(
        lin.length ? inArray(schema.suppressionList.linkedinId, lin) : undefined,
        lin.length ? inArray(schema.suppressionList.providerId, lin) : undefined,
        pub.length ? inArray(schema.suppressionList.publicIdentifier, pub) : undefined,
      ),
    );
  const hitIds = new Set(hits.flatMap((h) => [h.linkedinId, h.providerId]).filter(Boolean));
  const hitPub = new Set(hits.map((h) => h.publicIdentifier).filter(Boolean));
  const out = new Set<number>();
  ids.forEach((r, i) => {
    if ((r.linkedinId && hitIds.has(r.linkedinId)) || (r.providerId && hitIds.has(r.providerId)) || (r.publicIdentifier && hitPub.has(r.publicIdentifier))) out.add(i);
  });
  return out;
}

/** Adds a person and stops anything in progress for them. */
export async function suppress(ids: Ids, opts: { label: string; reason: string; userId: string | null }) {
  const c = clean(ids);
  if (!c.linkedinId && !c.publicIdentifier && !c.providerId) return false;
  if (await isSuppressed(c)) return false;
  await db.insert(schema.suppressionList).values({ ...c, label: opts.label.slice(0, 200), reason: opts.reason.slice(0, 200), createdByUserId: opts.userId });
  await stopActiveFor(c, "On the do-not-contact list");
  return true;
}

/** Excludes every pending or active campaign lead matching these identifiers. */
export async function stopActiveFor(ids: Ids, note: string) {
  const c = clean(ids);
  const leadIds = await matchingLeadIds(c);
  if (!leadIds.length) return 0;
  const res = await db
    .update(schema.leadState)
    .set({ status: "excluded", waiting: null, nextRunAt: null, note })
    .where(and(inArray(schema.leadState.leadId, leadIds), inArray(schema.leadState.status, ["pending", "active"])))
    .returning({ id: schema.leadState.id });
  if (res.length) {
    await db
      .update(schema.messageDrafts)
      .set({ status: "discarded", updatedAt: new Date() })
      .where(and(inArray(schema.messageDrafts.leadStateId, res.map((r) => r.id)), inArray(schema.messageDrafts.status, ["drafted", "approved"])));
  }
  return res.length;
}

async function matchingLeadIds(c: ReturnType<typeof clean>): Promise<string[]> {
  const conds = [
    c.linkedinId ? or(eq(schema.leads.linkedinId, c.linkedinId), eq(schema.leads.providerId, c.linkedinId)) : undefined,
    c.publicIdentifier ? eq(schema.leads.publicIdentifier, c.publicIdentifier) : undefined,
    c.providerId ? or(eq(schema.leads.providerId, c.providerId), eq(schema.leads.linkedinId, c.providerId)) : undefined,
  ].filter(Boolean);
  if (!conds.length) return [];
  const rows = await db.select({ id: schema.leads.id }).from(schema.leads).where(or(...conds));
  return rows.map((r) => r.id);
}

/** Reads a pasted LinkedIn URL, slug or member id. */
export function idsFromInput(input: string): Ids | null {
  const t = input.trim();
  if (!t) return null;
  const parsed = parseProfileUrl(t);
  if (parsed.publicIdentifier || parsed.linkedinId) return { publicIdentifier: parsed.publicIdentifier, linkedinId: parsed.linkedinId };
  if (/^[A-Za-z0-9_-]{6,}$/.test(t)) return /^AC[a-zA-Z0-9_-]+$/.test(t) ? { providerId: t, linkedinId: t } : { publicIdentifier: t.toLowerCase() };
  return null;
}

/**
 * Privacy deletion: removes every lead, campaign record, draft, conversation and message
 * for the person, then keeps only their LinkedIn identifiers on the do-not-contact list so
 * they are not imported again.
 */
export async function forgetPerson(ids: Ids, userId: string) {
  const c = clean(ids);
  const matched = await matchingLeadIds(c);
  const leadRows = matched.length ? await db.select().from(schema.leads).where(inArray(schema.leads.id, matched)) : [];
  // Gather every identifier we know for them, so the list entry catches all formats.
  const all = {
    linkedinId: c.linkedinId ?? leadRows.find((l) => l.linkedinId)?.linkedinId ?? null,
    publicIdentifier: c.publicIdentifier ?? leadRows.find((l) => l.publicIdentifier)?.publicIdentifier ?? null,
    providerId: c.providerId ?? leadRows.find((l) => l.providerId)?.providerId ?? null,
  };
  const leadIds = leadRows.map((l) => l.id);
  const providerIds = [...new Set([all.providerId, ...leadRows.map((l) => l.providerId)].filter((x): x is string => !!x))];

  return db.transaction(async (tx) => {
    const convs = await tx
      .delete(schema.conversations)
      .where(
        or(
          leadIds.length ? inArray(schema.conversations.leadId, leadIds) : undefined,
          providerIds.length ? inArray(schema.conversations.prospectProviderId, providerIds) : undefined,
          sql`false`,
        ),
      )
      .returning({ id: schema.conversations.id });
    if (leadIds.length) await tx.delete(schema.playgroundRuns).where(inArray(schema.playgroundRuns.leadId, leadIds));
    const deleted = leadIds.length ? await tx.delete(schema.leads).where(inArray(schema.leads.id, leadIds)).returning({ listId: schema.leads.listId }) : [];
    for (const listId of new Set(deleted.map((d) => d.listId))) {
      await tx.execute(sql`update lead_lists set lead_count = (select count(*) from leads where list_id = ${listId}) where id = ${listId}`);
    }
    // Merge into an existing entry or add one, with no name or notes.
    await tx.delete(schema.suppressionList).where(
      or(
        all.linkedinId ? eq(schema.suppressionList.linkedinId, all.linkedinId) : undefined,
        all.publicIdentifier ? eq(schema.suppressionList.publicIdentifier, all.publicIdentifier) : undefined,
        all.providerId ? eq(schema.suppressionList.providerId, all.providerId) : undefined,
        sql`false`,
      ),
    );
    if (all.linkedinId || all.publicIdentifier || all.providerId) {
      await tx.insert(schema.suppressionList).values({ ...all, label: "", reason: "Deletion request", createdByUserId: userId });
    }
    return { leads: deleted.length, conversations: convs.length };
  });
}
