import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { MAX_PAGES } from "@/lib/imports";
import { usableAccounts } from "@/lib/permissions";
import { BasicSearchForm } from "../forms";

export const instant = false;
export const metadata: Metadata = { title: "LinkedIn search" };

export default async function BasicSearchPage() {
  const user = await requireUser();
  const accounts = await usableAccounts(user);
  return (
    <div className="max-w-2xl">
      <Link href="/lead-sources/new" className="text-sm text-muted hover:text-ink">← Back</Link>
      <h1 className="mt-2 text-xl font-semibold">LinkedIn search</h1>
      <p className="mt-1 text-sm text-muted">
        Uses LinkedIn&apos;s standard people search. For precise seniority and company-size filters, use a Sales Navigator search instead.
      </p>
      <div className="mt-6">
        {accounts.length ? (
          <BasicSearchForm accounts={accounts.map((a) => ({ id: a.id, name: a.name || "LinkedIn account" }))} maxPages={MAX_PAGES.basic_search} />
        ) : (
          <div className="card p-6 text-sm">
            <p className="font-medium">No connected LinkedIn account you can use.</p>
            <p className="mt-1 text-muted">
              Connect one on the <Link href="/accounts" className="text-brand hover:underline">Accounts</Link> page first.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
