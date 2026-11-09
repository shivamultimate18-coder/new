import type { Metadata } from "next";
import Link from "next/link";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { ConfirmButton } from "@/components/confirm-button";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { removeFromDoNotContact } from "../actions";
import { AddDoNotContactForm, ForgetPersonForm } from "../forms";

export const instant = false;
export const metadata: Metadata = { title: "Do not contact" };

const PER_PAGE = 50;

export default async function DoNotContactPage({ searchParams }: PageProps<"/settings/do-not-contact">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const where = q
    ? or(ilike(schema.suppressionList.label, like), ilike(schema.suppressionList.publicIdentifier, like), ilike(schema.suppressionList.reason, like))
    : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ s: schema.suppressionList, by: schema.users.name })
      .from(schema.suppressionList)
      .leftJoin(schema.users, eq(schema.users.id, schema.suppressionList.createdByUserId))
      .where(where)
      .orderBy(desc(schema.suppressionList.createdAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    db.select({ n: count() }).from(schema.suppressionList).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(n / PER_PAGE));
  const isAdmin = user.role === "admin";

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Do not contact</h1>
        <p className="mt-1 text-sm text-muted">
          People nobody on the team will contact, from any account or campaign. They are left out of imports and campaigns, and anyone already in progress is stopped.
        </p>
      </div>

      <AddDoNotContactForm />

      <section>
        <form className="flex gap-2" role="search">
          <input name="q" defaultValue={q} placeholder="Search" className="input max-w-xs" aria-label="Search the list" />
          <button type="submit" className="btn btn-secondary">Search</button>
        </form>
        <form action={removeFromDoNotContact}>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  {isAdmin && <th className="w-10 px-4 py-2"><span className="sr-only">Select</span></th>}
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ s, by }) => (
                  <tr key={s.id}>
                    {isAdmin && (
                      <td className="px-4 py-2">
                        {s.reason !== "Deletion request" && <input type="checkbox" name="id" value={s.id} aria-label={`Select ${s.label || s.publicIdentifier || "entry"}`} />}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <div>{s.label || (s.reason === "Deletion request" ? "Deleted person" : "")}</div>
                      <div className="font-mono text-xs text-muted">{s.publicIdentifier ? `in/${s.publicIdentifier}` : (s.providerId ?? s.linkedinId)}</div>
                    </td>
                    <td className="px-4 py-2 text-muted">{s.reason}</td>
                    <td className="px-4 py-2 text-muted">{ago(s.createdAt)}{by ? ` by ${by}` : ""}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">{q ? "Nobody matches." : "The list is empty."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {isAdmin && rows.some((r) => r.s.reason !== "Deletion request") && (
            <ConfirmButton message="Take the selected people off the list? They could be contacted again." className="btn btn-secondary mt-3">
              Remove selected
            </ConfirmButton>
          )}
        </form>
        {pages > 1 && (
          <nav className="mt-3 flex items-center gap-3 text-sm" aria-label="Pages">
            {page > 1 && <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`} className="btn btn-secondary">Previous</Link>}
            <span className="text-muted">Page {page} of {pages}</span>
            {page < pages && <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`} className="btn btn-secondary">Next</Link>}
          </nav>
        )}
      </section>

      {isAdmin && <ForgetPersonForm />}
    </div>
  );
}
