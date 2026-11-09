import Link from "next/link";
import { and, asc, count, eq } from "drizzle-orm";
import { Performance, RangeFilter } from "@/components/performance";
import { db, schema } from "@/db";
import { parseRange } from "@/lib/analytics";
import type { RangeKey } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { budgetStatus } from "@/lib/budget";
import { env } from "@/lib/env";

// Every page here is per-user and reads the session cookie, so it renders on request.
export const instant = false;

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const campaignId = typeof sp.campaign === "string" && /^[0-9a-f-]{36}$/i.test(sp.campaign) ? sp.campaign : null;
  const campaigns = await db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name));
  const hrefFor = (r: RangeKey) => `/?${new URLSearchParams({ range: r, ...(campaignId ? { campaign: campaignId } : {}) })}`;
  const rows = await db
    .select({ status: schema.accounts.status, n: count() })
    .from(schema.accounts)
    .groupBy(schema.accounts.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const [{ n: sending }] = await db
    .select({ n: count() })
    .from(schema.accounts)
    .where(eq(schema.accounts.enabled, true));
  const [{ n: paused }] = await db
    .select({ n: count() })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.status, "ok"), eq(schema.accounts.enabled, false)));
  const attention = (by.needs_reconnect ?? 0) + (by.error ?? 0) + (by.disconnected ?? 0) + paused;

  const [{ n: awaitingApproval }] = await db
    .select({ n: count() })
    .from(schema.leadState)
    .where(and(eq(schema.leadState.status, "active"), eq(schema.leadState.waiting, "approval")));

  const [{ n: unreadReplies }] = await db
    .select({ n: count() })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.unread, true), eq(schema.conversations.lastFromProspect, true)));

  const budget = await budgetStatus();
  const accountTiles = [
    { label: "Connected accounts", value: by.ok ?? 0 },
    { label: "Switched on", value: sending },
    { label: "Need attention", value: attention, href: "/accounts/health" },
    { label: "Drafts waiting for approval", value: awaitingApproval, href: "/message-review" },
    { label: "Replies to answer", value: unreadReplies, href: "/inbox?unread=1" },
  ] as { label: string; value: number; href?: string }[];
  return (
    <div className="max-w-7xl">
      <h1 className="text-xl font-semibold">Hello, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-muted">Here is what happened across your accounts. Days are in {env.APP_TIMEZONE.replace(/_/g, " ")}.</p>

      {budget.share !== null && budget.share >= 0.8 && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span aria-hidden>⚠</span>
          {budget.share >= 1 ? "The monthly AI budget is used up, so drafting is paused." : `${Math.round(budget.share * 100)}% of the monthly AI budget is used.`}{" "}
          <Link href="/settings/usage" className="underline">AI usage</Link>
        </p>
      )}
      <h2 className="mt-6 font-medium">Needs attention</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {accountTiles.map((t) => {
          const body = (
            <>
              <div className="text-sm text-muted">{t.label}</div>
              <div className="mt-1 text-2xl font-semibold">{t.value}</div>
            </>
          );
          const cls = `card block p-3 sm:p-4 ${t.label === "Need attention" && t.value > 0 ? "border-red-300" : ""}`;
          return t.href ? (
            <Link key={t.label} href={t.href} className={`${cls} hover:border-brand`}>{body}</Link>
          ) : (
            <div key={t.label} className={cls}>{body}</div>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Performance</h2>
        <div className="flex flex-wrap items-center gap-3">
          <RangeFilter range={range} hrefFor={hrefFor} />
          <form className="flex items-center gap-2">
            <input type="hidden" name="range" value={range} />
            <select name="campaign" defaultValue={campaignId ?? ""} className="input w-auto py-1.5 text-sm" aria-label="Campaign">
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="btn btn-secondary px-3 py-1.5 text-xs">Apply</button>
          </form>
        </div>
      </div>
      <div className="mt-3">
        <Performance range={range} campaignId={campaignId} showCampaigns={!campaignId} showAccounts />
      </div>
    </div>
  );
}
