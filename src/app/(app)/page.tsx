import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

// Every page here is per-user and reads the session cookie, so it renders on request.
export const instant = false;

export default async function HomePage() {
  const user = await requireUser();
  const rows = await db
    .select({ status: schema.accounts.status, n: count() })
    .from(schema.accounts)
    .groupBy(schema.accounts.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const [{ n: sending }] = await db
    .select({ n: count() })
    .from(schema.accounts)
    .where(eq(schema.accounts.enabled, true));
  const attention = (by.needs_reconnect ?? 0) + (by.error ?? 0) + (by.disconnected ?? 0);

  const tiles = [
    { label: "Connected accounts", value: by.ok ?? 0 },
    { label: "Switched on", value: sending },
    { label: "Need attention", value: attention },
  ];
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold">Hello, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-muted">
        Invites, approvals, messages and replies will show here once campaigns exist.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className="text-sm text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>
      <Link href="/accounts" className="btn btn-secondary mt-6">
        Manage accounts
      </Link>
    </div>
  );
}
