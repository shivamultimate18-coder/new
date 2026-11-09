import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { ago } from "@/components/list-status";
import { CampaignStatus } from "@/components/campaign-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { playbookById } from "@/lib/campaigns/playbooks";
import { createCampaign } from "./actions";

export const instant = false;
export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  await requireUser();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ["draft", "running", "paused", "completed"].includes(sp.status) ? sp.status : null;

  const rows = await db
    .select({
      c: schema.campaigns,
      listName: schema.leadLists.name,
      enrolled: sql<number>`(select count(*)::int from lead_state ls where ls.campaign_id = ${schema.campaigns.id} and ls.status <> 'skipped')`,
      inProgress: sql<number>`(select count(*)::int from lead_state ls where ls.campaign_id = ${schema.campaigns.id} and ls.status = 'active')`,
      accounts: sql<number>`(select count(*)::int from campaign_accounts ca where ca.campaign_id = ${schema.campaigns.id})`,
    })
    .from(schema.campaigns)
    .leftJoin(schema.leadLists, eq(schema.leadLists.id, schema.campaigns.leadListId))
    .where(status ? eq(schema.campaigns.status, status as "draft") : undefined)
    .orderBy(desc(schema.campaigns.createdAt))
    .limit(100);

  const filters = [null, "running", "paused", "draft", "completed"] as const;
  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">A lead list, a sequence, the accounts that send it and when.</p>
        </div>
        <form action={createCampaign}>
          <button type="submit" className="btn btn-primary">New campaign</button>
        </form>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter by status">
        {filters.map((f) => (
          <Link
            key={f ?? "all"}
            href={f ? `/campaigns?status=${f}` : "/campaigns"}
            aria-current={status === f ? "page" : undefined}
            className={`btn px-3 py-1.5 ${status === f ? "btn-primary" : "btn-secondary"}`}
          >
            {f ? f[0].toUpperCase() + f.slice(1) : "All"}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="card mt-4 p-10 text-center">
          <p className="font-medium">{status ? `No ${status} campaigns` : "No campaigns yet"}</p>
          {!status && <p className="mt-1 text-sm text-muted">Create one to choose a lead list, a sequence and the accounts that send it.</p>}
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ c, listName, enrolled, inProgress, accounts }) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="card flex h-full flex-col p-4 hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <CampaignStatus status={c.status} />
                </div>
                <span className="mt-1 text-xs text-muted">
                  {playbookById(c.playbook).name} · {c.steps.filter((s) => s.type === "message").length} messages · created {ago(c.createdAt)}
                </span>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Prospects</dt>
                    <dd className="tabular-nums">{enrolled.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">In progress</dt>
                    <dd className="tabular-nums">{inProgress.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Accounts</dt>
                    <dd className="tabular-nums">{accounts}</dd>
                  </div>
                </dl>
                <span className="mt-3 truncate text-xs text-muted">{listName ? `List: ${listName}` : "No lead list chosen"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
