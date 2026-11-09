import type { Metadata } from "next";
import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import { pct, rate } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { SAFETY } from "@/lib/engine/engine";
import { isFuture } from "@/lib/time";

export const instant = false;
export const metadata: Metadata = { title: "Account health" };

type Row = {
  id: string;
  invites24: number;
  messages24: number;
  actions24: number;
  invites7d: number;
  pending: number;
  waitingAcceptance: number;
  invited14: number;
  accepted14: number;
  lastError: string | null;
};

export default async function HealthPage() {
  await requireUser();
  const accounts = await db.select().from(schema.accounts).orderBy(asc(schema.accounts.name));
  const stats = await db.execute<Row>(sql`
    select a.id::text as id,
      (select count(*) from activity_log l where l.account_id = a.id and l.type = 'invite.sent' and l.at > now() - interval '24 hours')::int as invites24,
      (select count(*) from activity_log l where l.account_id = a.id and l.type = 'message.sent' and l.at > now() - interval '24 hours')::int as messages24,
      (select count(*) from activity_log l where l.account_id = a.id and l.type in ('invite.sent','message.sent','profile.lookup') and l.at > now() - interval '24 hours')::int as actions24,
      (select count(*) from activity_log l where l.account_id = a.id and l.type = 'invite.sent' and l.at > now() - interval '7 days')::int as invites7d,
      (select count(*) from lead_state s where s.account_id = a.id and s.status in ('pending','active') and s.waiting is null)::int as pending,
      (select count(*) from lead_state s where s.account_id = a.id and s.waiting = 'acceptance')::int as "waitingAcceptance",
      (select count(*) from lead_state s where s.account_id = a.id and s.invite_sent_at > now() - interval '14 days')::int as invited14,
      (select count(*) from lead_state s where s.account_id = a.id and s.invite_sent_at > now() - interval '14 days' and s.accepted_at is not null)::int as accepted14,
      (select l.detail->>'reason' from activity_log l where l.account_id = a.id and l.type = 'account.paused' order by l.at desc limit 1) as "lastError"
    from accounts a
  `);
  const by = new Map([...stats].map((r) => [r.id, r]));

  const rows = accounts.map((a) => {
    const s = by.get(a.id)!;
    const problems: string[] = [];
    if (a.status === "needs_reconnect") problems.push("Needs reconnect");
    else if (a.status === "error" || a.status === "disconnected") problems.push(a.status === "error" ? "Unipile error" : "Disconnected");
    else if (a.status === "pending") problems.push("Sign-in not finished");
    if (a.status === "ok" && !a.enabled) problems.push(a.pausedReason ? "Paused by the engine" : "Switched off");
    // The engine never goes over these; seeing it means something is wrong (or a teammate sent by hand).
    if (s.invites24 > a.dailyInviteLimit) problems.push("Over the daily invite limit");
    if (s.invites7d > SAFETY.invitesPerWeek) problems.push("Over the weekly invite limit");
    if (s.actions24 > SAFETY.actionsPerDay) problems.push("Over 120 actions in 24 hours");
    if (isFuture(a.invitesPausedUntil)) problems.push(`Invites paused until ${a.invitesPausedUntil.toISOString().slice(0, 16).replace("T", " ")} UTC (LinkedIn limit)`);
    if (a.consecutiveRejects > 0) problems.push(`${a.consecutiveRejects} rejected request${a.consecutiveRejects === 1 ? "" : "s"} in a row`);
    if (a.consecutiveErrors > 0) problems.push(`${a.consecutiveErrors} error${a.consecutiveErrors === 1 ? "" : "s"} in a row`);
    const acceptance = rate(s.accepted14, s.invited14);
    // A low acceptance rate over a real sample is an early warning that LinkedIn may be limiting the account.
    if (acceptance !== null && s.invited14 >= 20 && acceptance < 0.15) problems.push("Low acceptance");
    return { a, s, problems, acceptance };
  });
  rows.sort((x, y) => y.problems.length - x.problems.length);
  const withProblems = rows.filter((r) => r.problems.length).length;

  return (
    <div className="max-w-7xl">
      <Link href="/accounts" className="text-sm text-muted hover:text-ink">← Accounts</Link>
      <h1 className="mt-2 text-xl font-semibold">Account health</h1>
      <p className="mt-1 text-sm text-muted">
        {accounts.length} account{accounts.length === 1 ? "" : "s"}, {withProblems} with a problem. Limits are rolling: the last 24 hours and the last 7 days. Accounts with problems are listed first.
      </p>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Problems</th>
              <th className="px-3 py-2 text-right font-medium">Invites 24 h</th>
              <th className="px-3 py-2 text-right font-medium">Invites 7 d</th>
              <th className="px-3 py-2 text-right font-medium">Messages 24 h</th>
              <th className="px-3 py-2 text-right font-medium">Actions 24 h</th>
              <th className="px-3 py-2 text-right font-medium">Acceptance 14 d</th>
              <th className="px-3 py-2 text-right font-medium">Queue</th>
              <th className="px-3 py-2 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ a, s, problems, acceptance }) => (
              <tr key={a.id} className={problems.length ? "bg-red-50/40" : ""}>
                <td className="px-3 py-2">
                  <div className="font-medium">{a.name || "LinkedIn account"}</div>
                  <div className="text-xs text-muted">{a.hasSalesNav ? "Sales Navigator · " : ""}warm-up {a.dailyInviteLimit}/{SAFETY.maxInvitesPerDay} invites</div>
                </td>
                <td className="px-3 py-2">
                  {problems.length ? (
                    <ul className="space-y-0.5">
                      {problems.map((p) => (
                        <li key={p} className="flex items-center gap-1.5 text-red-800">
                          <span aria-hidden>⚠</span>
                          {p}
                        </li>
                      ))}
                      {s.lastError && a.pausedReason && <li className="max-w-xs text-xs text-muted">{a.pausedReason}</li>}
                    </ul>
                  ) : (
                    <span className="flex items-center gap-1.5 text-emerald-800"><span aria-hidden>✓</span>Healthy</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.invites24} / {a.dailyInviteLimit}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.invites7d} / {SAFETY.invitesPerWeek}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.messages24} / {a.dailyMessageLimit}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${s.actions24 >= SAFETY.actionsPerDay * 0.9 ? "font-medium text-amber-800" : ""}`}>{s.actions24} / {SAFETY.actionsPerDay}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(acceptance)}{s.invited14 ? <span className="text-xs text-muted"> of {s.invited14}</span> : null}</td>
                <td className="px-3 py-2 text-right text-xs text-muted tabular-nums">{s.pending} due · {s.waitingAcceptance} awaiting</td>
                <td className="px-3 py-2 text-muted">{ago(a.lastActivityAt) || "Never"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted">No accounts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
