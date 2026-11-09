import type { Metadata } from "next";
import Link from "next/link";
import { count, desc, ilike } from "drizzle-orm";
import { AutoRefresh } from "@/components/auto-refresh";
import { ACTIVE_STATUSES, ListStatus, SOURCE_LABEL, ago, listDetail } from "@/components/list-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

export const instant = false;
export const metadata: Metadata = { title: "Lead Sources" };

const PER_PAGE = 20;

export default async function LeadSourcesPage({ searchParams }: PageProps<"/lead-sources">) {
  await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = q ? ilike(schema.leadLists.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined;

  const [lists, [{ n: total }]] = await Promise.all([
    db
      .select()
      .from(schema.leadLists)
      .where(where)
      .orderBy(desc(schema.leadLists.createdAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    db.select({ n: count() }).from(schema.leadLists).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (p: number) => `/lead-sources?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="max-w-6xl">
      <AutoRefresh active={lists.some((l) => ACTIVE_STATUSES.includes(l.status))} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Lead Sources</h1>
          <p className="mt-1 text-sm text-muted">
            Lead lists from Sales Navigator searches, CSV files and LinkedIn searches, ready to use in campaigns.
          </p>
        </div>
        <Link href="/lead-sources/new" className="btn btn-primary">
          New lead list
        </Link>
      </div>

      <form className="mt-6 max-w-sm" role="search">
        <label className="sr-only" htmlFor="q">Search lists</label>
        <input id="q" name="q" defaultValue={q} placeholder="Search lists by name" className="input" />
      </form>

      {lists.length === 0 ? (
        <div className="card mt-4 p-10 text-center">
          <p className="font-medium">{q ? "No lists match that search" : "No lead lists yet"}</p>
          {!q && (
            <p className="mt-1 text-sm text-muted">
              Import a Sales Navigator search or upload a CSV to create your first list.
            </p>
          )}
        </div>
      ) : (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">List</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Detail</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lists.map((l) => (
                <tr key={l.id} className="hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link href={`/lead-sources/${l.id}`} className="font-medium hover:underline">
                      {l.name}
                    </Link>
                    <div className="text-xs text-muted">{SOURCE_LABEL[l.source]}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{l.leadCount.toLocaleString()}</td>
                  <td className="px-4 py-3"><ListStatus status={l.status} /></td>
                  <td className="max-w-xs px-4 py-3 text-muted">
                    <span className="line-clamp-2">{listDetail(l)}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{ago(l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
          {page > 1 && <Link href={href(page - 1)} className="btn btn-secondary">Previous</Link>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <Link href={href(page + 1)} className="btn btn-secondary">Next</Link>}
        </nav>
      )}
    </div>
  );
}
