import { randomUUID } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeadList } from "@/db/schema";
import { env } from "./env";
import { leadFromSearchItem } from "./linkedin";
import type { LeadInput } from "./linkedin";
import { enqueueImportPage } from "./queue";
import { suppressedIndexes } from "./suppression";
import { isPermanentUnipileError, searchPeople } from "./unipile";
import type { SearchBody, SearchPage } from "./unipile";

/** Results per page. LinkedIn shows 25 per page in Sales Navigator. */
export const PAGE_SIZE = 25;
/** LinkedIn stops returning results past these points. */
export const MAX_RESULTS = { sales_nav: 2500, basic_search: 1000 } as const;
export const MAX_PAGES = {
  sales_nav: MAX_RESULTS.sales_nav / PAGE_SIZE,
  basic_search: MAX_RESULTS.basic_search / PAGE_SIZE,
} as const;
/**
 * Search pages each LinkedIn account may load per day (40 x 25 = 1,000 profiles). Searches
 * count as account activity, so this is deliberately conservative. Adjust after the pilot.
 */
export const SEARCH_PAGES_PER_DAY = 40;

/** Seconds between pages of one import, randomised so traffic does not look scripted. */
function pageGapSeconds() {
  if (env.UNIPILE_MOCK) return 1 + Math.random() * 2;
  return 25 + Math.random() * 50;
}

/**
 * Inserts leads, skipping ones already in the list and anyone on the do-not-contact list.
 * Returns how many were new; `onSuppressed` receives how many were left out for the list.
 */
export async function insertLeads(listId: string, rows: LeadInput[], onSuppressed?: (n: number) => void): Promise<number> {
  let added = 0;
  let suppressed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const blocked = await suppressedIndexes(batch);
    suppressed += blocked.size;
    const chunk = batch.filter((_, j) => !blocked.has(j)).map((r) => ({ ...r, listId }));
    if (!chunk.length) continue;
    const inserted = await db
      .insert(schema.leads)
      .values(chunk)
      .onConflictDoNothing({ target: [schema.leads.listId, schema.leads.dedupeKey] })
      .returning({ id: schema.leads.id });
    added += inserted.length;
  }
  onSuppressed?.(suppressed);
  return added;
}

async function refreshLeadCount(listId: string) {
  await db
    .update(schema.leadLists)
    .set({
      leadCount: sql`(select count(*)::int from ${schema.leads} where ${schema.leads.listId} = ${listId})`,
      updatedAt: new Date(),
    })
    .where(eq(schema.leadLists.id, listId));
}

/** Points the list at a fresh job token and queues that job. */
export async function scheduleNextPage(listId: string, delaySeconds: number, status: LeadList["status"] = "running") {
  const token = randomUUID();
  await db
    .update(schema.leadLists)
    .set({ jobToken: token, status, updatedAt: new Date() })
    .where(eq(schema.leadLists.id, listId));
  await enqueueImportPage({ listId, token }, delaySeconds);
}

async function finish(listId: string, status: "ready" | "failed", error: string | null = null) {
  await db
    .update(schema.leadLists)
    .set({ status, error, jobToken: null, updatedAt: new Date() })
    .where(eq(schema.leadLists.id, listId));
  await refreshLeadCount(listId);
}

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function searchPagesToday(accountId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.accountId, accountId),
        eq(schema.activityLog.type, "search.page"),
        gte(schema.activityLog.at, startOfUtcDay()),
      ),
    );
  return n;
}

async function lastSearchAt(accountId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date>`max(${schema.activityLog.at})` })
    .from(schema.activityLog)
    .where(and(eq(schema.activityLog.accountId, accountId), eq(schema.activityLog.type, "search.page")));
  return row?.at ? new Date(row.at) : null;
}

function mockPage(list: LeadList, cursor: string | null): SearchPage {
  const page = cursor ? Number(cursor) : 0;
  const titles = ["Founder", "CEO", "Head of Growth", "VP Sales", "Owner", "Managing Partner"];
  const companies = ["Northwind", "Acme Paving", "Bluepeak Labs", "Harbor & Co", "Lumen Dental", "Fieldstone"];
  const items = Array.from({ length: PAGE_SIZE }, (_, i) => {
    const n = page * PAGE_SIZE + i + 1;
    return {
      id: `MOCK${list.id.slice(0, 8)}${n}`,
      first_name: `Test${n}`,
      last_name: "Lead",
      headline: `${titles[n % titles.length]} at ${companies[n % companies.length]}`,
      location: "Austin, Texas, United States",
      industry: "Construction",
      current_positions: [{ company: companies[n % companies.length], role: titles[n % titles.length] }],
    };
  });
  return { items, cursor: String(page + 1), totalCount: 1200 };
}

/** Stored params minus our own display-only fields. */
function searchBodyOf(params: unknown): SearchBody {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { display, ...body } = params as SearchBody & { display?: unknown };
  return body as SearchBody;
}

export type PageOutcome =
  | "skipped"
  | "page-imported"
  | "finished"
  | "waiting-for-budget"
  | "spacing"
  | "failed";

/**
 * Imports one page of a search list, then queues the next. Called by the worker.
 * Throws on temporary errors so the queue retries; permanent errors fail the list.
 */
export async function runImportPage(listId: string, token: string): Promise<PageOutcome> {
  const [list] = await db.select().from(schema.leadLists).where(eq(schema.leadLists.id, listId));
  if (!list || list.jobToken !== token) return "skipped";
  if (!["queued", "running", "waiting"].includes(list.status)) return "skipped";
  if (list.source === "csv") return "skipped";

  if (list.pagesDone >= list.pagesRequested) {
    await finish(list.id, "ready");
    return "finished";
  }

  const [account] = list.accountId
    ? await db.select().from(schema.accounts).where(eq(schema.accounts.id, list.accountId))
    : [];
  if (!account || !account.unipileAccountId) {
    await finish(list.id, "failed", "The LinkedIn account for this import was removed.");
    return "failed";
  }
  if (account.status !== "ok") {
    await finish(list.id, "failed", "The LinkedIn account is not connected. Reconnect it, then retry.");
    return "failed";
  }
  if (list.source === "sales_nav" && !account.hasSalesNav) {
    await finish(list.id, "failed", "The LinkedIn account is not marked as having Sales Navigator.");
    return "failed";
  }

  // Daily budget per account; wait for tomorrow instead of failing.
  if ((await searchPagesToday(account.id)) >= SEARCH_PAGES_PER_DAY) {
    const tomorrow = startOfUtcDay().getTime() + 24 * 3600 * 1000;
    const delay = (tomorrow - Date.now()) / 1000 + 300 + Math.random() * 3600;
    await scheduleNextPage(list.id, delay, "waiting");
    return "waiting-for-budget";
  }
  // Keep pages from different imports on the same account apart.
  const last = await lastSearchAt(account.id);
  const minGap = env.UNIPILE_MOCK ? 0 : 20;
  if (last && Date.now() - last.getTime() < minGap * 1000) {
    await scheduleNextPage(list.id, minGap + Math.random() * 20);
    return "spacing";
  }

  if (list.status !== "running") {
    await db
      .update(schema.leadLists)
      .set({ status: "running", error: null, updatedAt: new Date() })
      .where(eq(schema.leadLists.id, list.id));
  }

  let page: SearchPage;
  try {
    page = env.UNIPILE_MOCK
      ? mockPage(list, list.cursor)
      : await searchPeople({
          unipileAccountId: account.unipileAccountId,
          body: searchBodyOf(list.params),
          cursor: list.cursor,
          limit: PAGE_SIZE,
        });
  } catch (e) {
    if (isPermanentUnipileError(e)) {
      await finish(list.id, "failed", `LinkedIn search failed: ${(e as Error).message.slice(0, 200)}`);
      return "failed";
    }
    throw e; // temporary: let the queue retry
  }

  await db.insert(schema.activityLog).values({
    accountId: account.id,
    type: "search.page",
    detail: { listId: list.id, page: list.pagesDone + 1, results: page.items.length },
  });
  await db
    .update(schema.accounts)
    .set({ lastActivityAt: new Date() })
    .where(eq(schema.accounts.id, account.id));

  const leads = page.items.map(leadFromSearchItem).filter((l): l is LeadInput => l !== null);
  await insertLeads(list.id, leads);

  const pagesDone = list.pagesDone + 1;
  await db
    .update(schema.leadLists)
    .set({
      pagesDone,
      cursor: page.cursor,
      reportedTotal: page.totalCount ?? list.reportedTotal,
      updatedAt: new Date(),
    })
    .where(eq(schema.leadLists.id, list.id));
  await refreshLeadCount(list.id);

  const more = page.items.length > 0 && page.cursor && pagesDone < list.pagesRequested;
  if (!more) {
    await finish(list.id, "ready");
    return "finished";
  }
  await scheduleNextPage(list.id, pageGapSeconds());
  return "page-imported";
}
