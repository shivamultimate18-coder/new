import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { usableAccounts } from "@/lib/permissions";

export const instant = false;
export const metadata: Metadata = { title: "New lead list" };

export default async function NewSourcePage() {
  const user = await requireUser();
  const salesNav = (await usableAccounts(user, { salesNavOnly: true })).length > 0;
  const options = [
    {
      href: "/lead-sources/new/sales-nav",
      title: "Sales Navigator search",
      body: "Paste a Sales Navigator people search and import the results page by page.",
      tag: salesNav ? "Recommended" : "Needs an account with Sales Navigator",
      tone: salesNav ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800",
    },
    {
      href: "/lead-sources/new/csv",
      title: "Upload a CSV",
      body: "A spreadsheet export with LinkedIn profile URLs, or names and companies.",
      tag: "Up to 10,000 rows",
      tone: "bg-zinc-100 text-zinc-700",
    },
    {
      href: "/lead-sources/new/search",
      title: "LinkedIn search",
      body: "Search LinkedIn by keywords, job title, seniority, location and industry.",
      tag: "No Sales Navigator needed",
      tone: "bg-zinc-100 text-zinc-700",
    },
  ];
  return (
    <div className="max-w-4xl">
      <Link href="/lead-sources" className="text-sm text-muted hover:text-ink">← Lead Sources</Link>
      <h1 className="mt-2 text-xl font-semibold">Where should the leads come from?</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {options.map((o) => (
          <Link key={o.href} href={o.href} className="card flex flex-col p-5 hover:border-brand">
            <span className="font-medium">{o.title}</span>
            <span className="mt-1 flex-1 text-sm text-muted">{o.body}</span>
            <span className={`mt-4 self-start rounded-full px-2 py-0.5 text-xs font-medium ${o.tone}`}>{o.tag}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
