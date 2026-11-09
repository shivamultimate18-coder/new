import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { budgetStatus, startOfMonthUtc, usageSince } from "@/lib/budget";
import { BudgetForm } from "../forms";

export const instant = false;
export const metadata: Metadata = { title: "AI usage" };

const FEATURE: Record<string, string> = {
  "campaign.draft": "Campaign drafts",
  "review.regenerate": "Regenerated drafts",
  "playground.draft": "Playground drafts",
  "playground.learn": "Rules from feedback",
  "product.icp": "Customer profiles",
  "inbox.classify": "Reply labels",
  "inbox.suggest": "Suggested replies",
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function UsagePage() {
  const user = await requireUser();
  const [status, rows] = await Promise.all([budgetStatus(), usageSince(startOfMonthUtc())]);
  rows.sort((a, b) => b.cost - a.cost);
  const share = status.share ?? 0;
  const tone = share >= 1 ? "bg-red-600" : share >= 0.8 ? "bg-amber-500" : "bg-brand";
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">AI usage</h1>
        <p className="mt-1 text-sm text-muted">Claude API spend in {month} (UTC), estimated from token counts at list prices. Check the Anthropic Console for the exact bill.</p>
      </div>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-sm text-muted">Spent this month</div>
            <div className="text-3xl font-semibold">{usd(status.spent)}</div>
          </div>
          <div className="text-sm text-muted">{status.budget === null ? "No monthly limit" : `of ${usd(status.budget)} limit`}</div>
        </div>
        {status.budget !== null && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Share of the monthly limit used">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
            </div>
            <p className={`mt-2 text-sm ${share >= 0.8 ? "font-medium text-red-800" : "text-muted"}`}>
              {share >= 1
                ? "The limit is reached. Drafting, labels and suggested replies are paused until next month or until the limit is raised."
                : share >= 0.8
                  ? `${Math.round(share * 100)}% used. Drafting pauses when the limit is reached.`
                  : `${Math.round(share * 100)}% used.`}
            </p>
          </div>
        )}
        {user.role === "admin" ? <BudgetForm current={status.budget} /> : <p className="text-xs text-muted">Only admins can change the limit.</p>}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="px-4 pt-4 font-medium">By feature</h2>
        <table className="mt-2 w-full min-w-[600px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Feature</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Calls</th>
              <th className="px-4 py-2 text-right font-medium">Tokens in / out</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={`${r.feature}-${r.model}`}>
                <td className="px-4 py-2">{FEATURE[r.feature] ?? r.feature}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted">{r.model}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{(r.input + r.cacheRead + r.cacheWrite).toLocaleString()} / {r.output.toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{usd(r.cost)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No Claude calls this month.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
