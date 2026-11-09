import Link from "next/link";
import { LineChart } from "@/components/line-chart";
import { RANGES, breakdown, dailySeries, pct, rate, totals } from "@/lib/analytics";
import type { Breakdown, RangeKey } from "@/lib/analytics";

/** Validated categorical slots 1-4 (light). See the dataviz palette notes in line-chart.tsx. */
const COLORS = { invites: "#2a78d6", accepted: "#eb6834", messages: "#1baf7a", replies: "#eda100" };

/** Range links, in the one filter row above everything they scope. */
export function RangeFilter({ range, hrefFor }: { range: RangeKey; hrefFor: (r: RangeKey) => string }) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Date range">
      {(Object.keys(RANGES) as RangeKey[]).map((r) => (
        <Link key={r} href={hrefFor(r)} aria-current={r === range ? "page" : undefined} className={`btn px-3 py-1.5 text-xs ${r === range ? "btn-primary" : "btn-secondary"}`}>
          Last {RANGES[r]} days
        </Link>
      ))}
    </nav>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function BreakdownTable({ title, rows, nameHeader, hrefFor }: { title: string; rows: Breakdown[]; nameHeader: string; hrefFor?: (id: string) => string }) {
  return (
    <section className="card overflow-x-auto">
      <h2 className="px-4 pt-4 font-medium">{title}</h2>
      <table className="mt-2 w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">{nameHeader}</th>
            <th className="px-4 py-2 text-right font-medium">Invited</th>
            <th className="px-4 py-2 text-right font-medium">Accepted</th>
            <th className="px-4 py-2 text-right font-medium">Acceptance</th>
            <th className="px-4 py-2 text-right font-medium">Messages</th>
            <th className="px-4 py-2 text-right font-medium">Replied</th>
            <th className="px-4 py-2 text-right font-medium">Reply rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2">{hrefFor ? <Link href={hrefFor(r.id)} className="hover:underline">{r.name}</Link> : r.name}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.invited.toLocaleString()}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.accepted.toLocaleString()}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pct(rate(r.accepted, r.invited))}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.messages.toLocaleString()}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.replied.toLocaleString()}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pct(rate(r.replied, r.accepted))}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No leads were invited in this period.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** Stat tiles, the daily chart and (optionally) breakdown tables for a period and campaign. */
export async function Performance(props: { range: RangeKey; campaignId?: string | null; showCampaigns?: boolean; showAccounts?: boolean }) {
  const scope = { days: RANGES[props.range], campaignId: props.campaignId };
  const [daily, t, byCampaign, byAccount] = await Promise.all([
    dailySeries(scope),
    totals(scope),
    props.showCampaigns ? breakdown(scope, "campaign") : Promise.resolve([]),
    props.showAccounts ? breakdown(scope, "account") : Promise.resolve([]),
  ]);
  const acceptance = rate(t.cohortAccepted, t.cohortInvited);
  const replyRate = rate(t.cohortReplied, t.cohortAccepted);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Tile label="Invites sent" value={t.invites} />
        <Tile label="Accepted" value={t.accepted} sub={`Acceptance ${pct(acceptance)} of ${t.cohortInvited.toLocaleString()} invited`} />
        <Tile label="Messages sent" value={t.messages} />
        <Tile label="Replies" value={t.replies} sub={`Reply rate ${pct(replyRate)} of ${t.cohortAccepted.toLocaleString()} accepted`} />
        <Tile label="Interested" value={t.interested} sub="Conversations labelled Interested" />
      </div>
      <section className="card p-4">
        <LineChart
          title="Daily activity"
          days={daily.map((d) => d.day)}
          series={[
            { key: "invites", label: "Invites", color: COLORS.invites, values: daily.map((d) => d.invites) },
            { key: "accepted", label: "Accepted", color: COLORS.accepted, values: daily.map((d) => d.accepted) },
            { key: "messages", label: "Messages", color: COLORS.messages, values: daily.map((d) => d.messages) },
            { key: "replies", label: "Replies", color: COLORS.replies, values: daily.map((d) => d.replies) },
          ]}
        />
        <p className="mt-2 text-xs text-muted">Rates count the leads invited in this period. Replies in the inbox to people outside campaigns are not included.</p>
      </section>
      {props.showCampaigns && <BreakdownTable title="By campaign" nameHeader="Campaign" rows={byCampaign} hrefFor={(id) => `/campaigns/${id}`} />}
      {props.showAccounts && <BreakdownTable title="By account" nameHeader="Account" rows={byAccount} />}
    </div>
  );
}
