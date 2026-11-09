import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { ACTIVE_STATUSES, ListStatus, SOURCE_LABEL, ago, listDetail } from "@/components/list-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { canManageList } from "@/lib/permissions";
import { cancelImport, deleteList, resumeImport } from "../actions";

export const instant = false;
export const metadata: Metadata = { title: "Lead list" };

const PER_PAGE = 50;

export default async function LeadListPage({ params, searchParams }: PageProps<"/lead-sources/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [row] = await db
    .select({ list: schema.leadLists, accountName: schema.accounts.name, creator: schema.users.name })
    .from(schema.leadLists)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.leadLists.accountId))
    .leftJoin(schema.users, eq(schema.users.id, schema.leadLists.createdByUserId))
    .where(eq(schema.leadLists.id, id));
  if (!row) notFound();
  const { list } = row;

  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const where = and(
    eq(schema.leads.listId, id),
    q
      ? or(
          ilike(schema.leads.firstName, like),
          ilike(schema.leads.lastName, like),
          ilike(schema.leads.company, like),
          ilike(schema.leads.title, like),
          ilike(schema.leads.headline, like),
        )
      : undefined,
  );
  const [leads, [{ n: total }]] = await Promise.all([
    db.select().from(schema.leads).where(where).orderBy(asc(schema.leads.seq)).limit(PER_PAGE).offset((page - 1) * PER_PAGE),
    db.select({ n: count() }).from(schema.leads).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (p: number) => `/lead-sources/${id}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  const active = ACTIVE_STATUSES.includes(list.status);
  const manage = canManageList(user, list);
  const params_ = list.params as Record<string, unknown>;
  const display = (params_.display as Record<string, string> | undefined) ?? {};
  const facts: [string, string][] = [
    ["Source", SOURCE_LABEL[list.source]],
    ...(row.accountName ? [["Account", row.accountName] as [string, string]] : []),
    ["Created by", row.creator ?? "—"],
    ["Created", ago(list.createdAt)],
  ];
  if (list.source !== "csv") {
    facts.push(["Pages", `${list.pagesDone} of ${list.pagesRequested}`]);
    if (list.reportedTotal != null) facts.push(["Search results on LinkedIn", list.reportedTotal.toLocaleString()]);
  } else {
    facts.push(["File", String(params_.fileName ?? "")]);
    facts.push(["Rows in file", String(params_.rows ?? "")]);
    facts.push(["Duplicates skipped", String(params_.duplicates ?? 0)]);
    facts.push(["Unusable rows skipped", String(params_.skipped ?? 0)]);
  }
  for (const [k, v] of Object.entries(display)) facts.push([k, v]);

  return (
    <div className="max-w-6xl">
      <AutoRefresh active={active} />
      <Link href="/lead-sources" className="text-sm text-muted hover:text-ink">← Lead Sources</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{list.name}</h1>
            <ListStatus status={list.status} />
          </div>
          <p className={`mt-1 text-sm ${list.status === "failed" ? "text-red-800" : "text-muted"}`}>
            {list.leadCount.toLocaleString()} leads · {listDetail(list)}
          </p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {active && (
              <form action={cancelImport}>
                <input type="hidden" name="id" value={list.id} />
                <button type="submit" className="btn btn-secondary">Stop import</button>
              </form>
            )}
            {list.source !== "csv" && (list.status === "failed" || list.status === "cancelled") && list.pagesDone < list.pagesRequested && (
              <form action={resumeImport}>
                <input type="hidden" name="id" value={list.id} />
                <button type="submit" className="btn btn-primary">Resume import</button>
              </form>
            )}
            <form action={deleteList}>
              <input type="hidden" name="id" value={list.id} />
              <ConfirmButton message={`Delete "${list.name}" and its ${list.leadCount} leads?`} className="btn btn-danger">
                Delete list
              </ConfirmButton>
            </form>
          </div>
        )}
      </div>

      {list.source === "sales_nav" && typeof params_.url === "string" && (
        <p className="mt-3 truncate text-xs text-muted">
          Search: <a href={params_.url} target="_blank" rel="noreferrer" className="hover:underline">{params_.url}</a>
        </p>
      )}

      <dl className="card mt-4 grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted">{k}</dt>
            <dd className="truncate" title={v}>{v}</dd>
          </div>
        ))}
      </dl>

      <form className="mt-6 max-w-sm" role="search">
        <label className="sr-only" htmlFor="q">Search leads</label>
        <input id="q" name="q" defaultValue={q} placeholder="Search by name, company or title" className="input" />
      </form>

      {leads.length === 0 ? (
        <div className="card mt-4 p-10 text-center text-sm text-muted">
          {q ? "No leads match that search." : active ? "Leads appear here as pages are imported." : "This list has no leads."}
        </div>
      ) : (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Title and company</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Industry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">
                    {l.profileUrl ? (
                      <a href={l.profileUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {`${l.firstName} ${l.lastName}`.trim() || "Unnamed"}
                      </a>
                    ) : (
                      <span className="font-medium">{`${l.firstName} ${l.lastName}`.trim() || "Unnamed"}</span>
                    )}
                    {l.headline && <div className="line-clamp-1 max-w-xs text-xs text-muted">{l.headline}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {[l.title, l.company].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.location ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{l.industry ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
          {page > 1 && <Link href={href(page - 1)} className="btn btn-secondary">Previous</Link>}
          <span className="text-muted">Page {page} of {pages} · {total.toLocaleString()} leads</span>
          {page < pages && <Link href={href(page + 1)} className="btn btn-secondary">Next</Link>}
        </nav>
      )}
    </div>
  );
}
