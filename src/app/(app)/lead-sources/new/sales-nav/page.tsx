import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { MAX_PAGES } from "@/lib/imports";
import { usableAccounts } from "@/lib/permissions";
import { SalesNavForm } from "../forms";

export const instant = false;
export const metadata: Metadata = { title: "Sales Navigator import" };

export default async function SalesNavPage() {
  const user = await requireUser();
  const accounts = await usableAccounts(user, { salesNavOnly: true });
  return (
    <div className="max-w-2xl">
      <Link href="/lead-sources/new" className="text-sm text-muted hover:text-ink">← Back</Link>
      <h1 className="mt-2 text-xl font-semibold">Import a Sales Navigator search</h1>
      <p className="mt-1 text-sm text-muted">
        Pages load slowly and at uneven intervals, and each account loads at most 40 pages a day, to keep the account safe.
      </p>
      <div className="mt-6">
        {accounts.length ? (
          <SalesNavForm accounts={accounts.map((a) => ({ id: a.id, name: a.name || "LinkedIn account" }))} maxPages={MAX_PAGES.sales_nav} />
        ) : (
          <div className="card p-6 text-sm">
            <p className="font-medium">No connected account you can use has Sales Navigator.</p>
            <p className="mt-1 text-muted">
              On the <Link href="/accounts" className="text-brand hover:underline">Accounts</Link> page, connect an account and mark it as Sales Navigator. Admins can use any team account; members can use their own.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
