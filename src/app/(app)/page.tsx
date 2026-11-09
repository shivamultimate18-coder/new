import Link from "next/link";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { hoursAgo } from "@/lib/time";
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
  const [{ n: paused }] = await db
    .select({ n: count() })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.status, "ok"), eq(schema.accounts.enabled, false)));
  const attention = (by.needs_reconnect ?? 0) + (by.error ?? 0) + (by.disconnected ?? 0) + paused;

  const since = hoursAgo(24);
  const activity = await db
    .select({ type: schema.activityLog.type, n: count() })
    .from(schema.activityLog)
    .where(and(gte(schema.activityLog.at, since), inArray(schema.activityLog.type, ["invite.sent", "invite.accepted", "message.sent", "lead.replied"])))
    .groupBy(schema.activityLog.type);
  const act = (t: string) => activity.find((r) => r.type === t)?.n ?? 0;
  const [{ n: awaitingApproval }] = await db
    .select({ n: count() })
    .from(schema.leadState)
    .where(and(eq(schema.leadState.status, "active"), eq(schema.leadState.waiting, "approval")));

  const tiles = [
    { label: "Invites sent", value: act("invite.sent") },
    { label: "Invites accepted", value: act("invite.accepted") },
    { label: "Messages sent", value: act("message.sent") },
    { label: "Replies", value: act("lead.replied") },
  ];
  const accountTiles = [
    { label: "Connected accounts", value: by.ok ?? 0 },
    { label: "Switched on", value: sending },
    { label: "Need attention", value: attention },
    { label: "Drafts waiting for approval", value: awaitingApproval },
  ];
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold">Hello, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-muted">The last 24 hours across every account.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className="text-sm text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>
      <h2 className="mt-8 font-medium">Accounts and approvals</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {accountTiles.map((t) => (
          <div key={t.label} className={`card p-4 ${t.label === "Need attention" && t.value > 0 ? "border-red-300" : ""}`}>
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
