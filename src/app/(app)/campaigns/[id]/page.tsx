import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq } from "drizzle-orm";
import { CampaignStatus } from "@/components/campaign-status";
import { ConfirmButton } from "@/components/confirm-button";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import type { Campaign } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { playbookById } from "@/lib/campaigns/playbooks";
import { readiness } from "@/lib/campaigns/readiness";
import { deleteCampaign, duplicateCampaign, excludeLeads, launchCampaign, setPaused } from "../actions";

export const instant = false;
export const metadata: Metadata = { title: "Campaign" };

const TABS = [
  { id: "leads", label: "Leads" },
  { id: "sequence", label: "Sequence" },
  { id: "settings", label: "Settings" },
] as const;

const LEAD_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Not started", tone: "bg-zinc-100 text-zinc-700" },
  // "active" covers waiting for acceptance, approval or the next message; the note says which.
  active: { label: "In progress", tone: "bg-blue-50 text-blue-800" },
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-800" },
  replied: { label: "Replied", tone: "bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-800" },
  skipped: { label: "Skipped", tone: "bg-zinc-100 text-zinc-700" },
  excluded: { label: "Excluded", tone: "bg-zinc-100 text-zinc-700" },
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PER_PAGE = 50;

function stepLabel(c: Campaign, i: number) {
  const s = c.steps[i];
  if (!s) return "Done";
  if (s.type === "invite") return "Connection request";
  return `Message ${i}`;
}

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "leads";

  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c) notFound();
  const manage = user.role === "admin" || c.createdByUserId === user.id;

  const [checks, counts, [list], [product], [style], accounts] = await Promise.all([
    readiness(c),
    db.select({ status: schema.leadState.status, n: count() }).from(schema.leadState).where(eq(schema.leadState.campaignId, id)).groupBy(schema.leadState.status),
    c.leadListId ? db.select().from(schema.leadLists).where(eq(schema.leadLists.id, c.leadListId)) : Promise.resolve([]),
    c.productId ? db.select().from(schema.products).where(eq(schema.products.id, c.productId)) : Promise.resolve([]),
    c.writingStyleId ? db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, c.writingStyleId)) : Promise.resolve([]),
    db
      .select({ a: schema.accounts })
      .from(schema.campaignAccounts)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.campaignAccounts.accountId))
      .where(eq(schema.campaignAccounts.campaignId, id)),
  ]);
  const pausedAccounts = accounts.filter(({ a }) => a.status !== "ok" || !a.enabled);
  const by = Object.fromEntries(counts.map((r) => [r.status, r.n])) as Record<string, number>;
  const total = counts.reduce((n, r) => n + (r.status === "skipped" ? 0 : r.n), 0);
  const ready = checks.every((x) => x.ok);
  const notReadyError = sp.error === "not-ready";

  const stats = [
    { label: "Not started", value: by.pending ?? 0 },
    { label: "In progress", value: by.active ?? 0 },
    { label: "Finished", value: (by.completed ?? 0) + (by.replied ?? 0) },
    { label: "Replied", value: by.replied ?? 0 },
  ];

  return (
    <div className="max-w-6xl">
      <Link href="/campaigns" className="text-sm text-muted hover:text-ink">← Campaigns</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{c.name}</h1>
            <CampaignStatus status={c.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {playbookById(c.playbook).name} · {list?.name ?? "no lead list"}
            {c.launchedAt ? ` · launched ${ago(c.launchedAt)}` : ""}
          </p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {c.status === "draft" && (
              <form action={launchCampaign}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton
                  message={`Launch "${c.name}"? ${list?.leadCount ?? 0} leads will be enrolled.`}
                  className="btn btn-primary"
                >
                  Launch
                </ConfirmButton>
              </form>
            )}
            {(c.status === "running" || c.status === "paused") && (
              <form action={setPaused}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="pause" value={c.status === "running" ? "1" : "0"} />
                <button type="submit" className={`btn ${c.status === "running" ? "btn-secondary" : "btn-primary"}`}>
                  {c.status === "running" ? "Pause" : "Resume"}
                </button>
              </form>
            )}
            <Link href={`/campaigns/${c.id}/edit`} className="btn btn-secondary">Edit</Link>
            <form action={duplicateCampaign}>
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className="btn btn-secondary">Duplicate</button>
            </form>
            {c.status !== "running" && (
              <form action={deleteCampaign}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton message={`Delete "${c.name}"? Its lead progress is deleted too.`} className="btn btn-danger">Delete</ConfirmButton>
              </form>
            )}
          </div>
        )}
      </div>

      {c.status === "running" && pausedAccounts.length > 0 && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {pausedAccounts.length === accounts.length ? "Every sending account is" : `${pausedAccounts.length} sending account${pausedAccounts.length === 1 ? " is" : "s are"}`} paused or disconnected, so
          {pausedAccounts.length === accounts.length ? " nothing is being sent." : " their leads are waiting."} Check the{" "}
          <Link href="/accounts" className="underline">Accounts</Link> page.
        </p>
      )}
      {notReadyError && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          The campaign is not ready yet. Fix the items marked below.
        </p>
      )}

      {c.status === "draft" ? (
        <section className="card mt-6 p-5">
          <h2 className="font-medium">Ready to launch?</h2>
          <ul className="mt-3 space-y-2">
            {checks.map((x) => (
              <li key={x.id} className="flex items-start gap-3 text-sm">
                <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${x.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {x.ok ? "✓" : "!"}
                </span>
                <span>
                  <span className="font-medium">{x.label}</span>
                  <span className="sr-only">{x.ok ? " (ready)" : " (needs attention)"}</span>
                  <span className="block text-muted">{x.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {!ready && manage && (
            <Link href={`/campaigns/${c.id}/edit`} className="btn btn-secondary mt-4">Finish setup</Link>
          )}
        </section>
      ) : (
        <dl className="mt-6 grid gap-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="card p-4">
              <dt className="text-sm text-muted">{s.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}

      <nav className="mt-6 flex gap-1 border-b border-line" aria-label="Campaign sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/campaigns/${c.id}${t.id === "leads" ? "" : `?tab=${t.id}`}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
            {t.id === "leads" && total > 0 ? ` (${total.toLocaleString()})` : ""}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "leads" && <LeadsTab campaign={c} manage={manage} statusFilter={typeof sp.status === "string" ? sp.status : null} page={Math.max(1, Number(sp.page) || 1)} skipped={by.skipped ?? 0} />}
        {tab === "sequence" && (
          <ol className="space-y-3">
            {c.steps.map((s, i) => (
              <li key={s.id} className="card p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{stepLabel(c, i)}</span>
                  {i > 0 && <span className="text-muted">wait {s.waitDays} day{s.waitDays === 1 ? "" : "s"} {i === 1 ? "after acceptance" : "if no reply"}</span>}
                </div>
                <p className="mt-1 text-muted">
                  {s.mode === "blank" ? "No note" : s.mode === "ai" ? "Drafted by AI for each lead, then reviewed" : "Template"}
                </p>
                {s.mode === "template" && <p className="mt-2 whitespace-pre-wrap rounded bg-canvas p-2">{s.template}</p>}
              </li>
            ))}
            {c.steps.length === 0 && <li className="text-sm text-muted">No steps yet.</li>}
          </ol>
        )}
        {tab === "settings" && (
          <dl className="card grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2">
            {[
              ["Lead list", list ? `${list.name} (${list.leadCount.toLocaleString()} leads)` : "Not chosen"],
              ["Product", product?.name ?? "Not chosen"],
              ["Writing style", style?.name ?? "Not chosen"],
              ["Playbook", playbookById(c.playbook).name],
              ["Active days", c.activeDays.map((d) => DAYS[d]).join(", ") || "None"],
              ["Active hours", `${c.activeFrom} to ${c.activeTo} (${c.timezone})`],
              ["Daily limits per account", `${c.dailyInviteLimit} connection requests, ${c.dailyMessageLimit} messages`],
              ["Sending accounts", accounts.map(({ a }) => `${a.name || "LinkedIn account"}${a.status !== "ok" || !a.enabled ? " (not usable)" : ""}`).join(", ") || "None"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

async function LeadsTab(props: { campaign: Campaign; manage: boolean; statusFilter: string | null; page: number; skipped: number }) {
  const { campaign: c } = props;
  const statuses = Object.keys(LEAD_STATUS);
  const filter = props.statusFilter && statuses.includes(props.statusFilter) ? props.statusFilter : null;
  const where = and(
    eq(schema.leadState.campaignId, c.id),
    filter ? eq(schema.leadState.status, filter as "pending") : undefined,
  );
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ s: schema.leadState, l: schema.leads, accountName: schema.accounts.name })
      .from(schema.leadState)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.leadState.accountId))
      .where(where)
      .orderBy(asc(schema.leads.seq))
      .limit(PER_PAGE)
      .offset((props.page - 1) * PER_PAGE),
    db.select({ n: count() }).from(schema.leadState).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(n / PER_PAGE));
  const href = (p: number) => `/campaigns/${c.id}?${new URLSearchParams({ ...(filter ? { status: filter } : {}), page: String(p) })}`;

  if (c.status === "draft") {
    return <p className="card p-8 text-center text-sm text-muted">Leads are enrolled from the list when the campaign launches.</p>;
  }
  const canExclude = props.manage && rows.some((r) => ["pending", "active"].includes(r.s.status));
  return (
    <div>
      <nav className="flex flex-wrap gap-2" aria-label="Filter leads">
        {[null, ...statuses].map((st) => (
          <Link
            key={st ?? "all"}
            href={`/campaigns/${c.id}${st ? `?status=${st}` : ""}`}
            aria-current={filter === st ? "page" : undefined}
            className={`btn px-3 py-1 text-xs ${filter === st ? "btn-primary" : "btn-secondary"}`}
          >
            {st ? LEAD_STATUS[st].label : "All"}
          </Link>
        ))}
      </nav>
      {props.skipped > 0 && !filter && (
        <p className="mt-3 text-xs text-muted">
          {props.skipped} lead{props.skipped === 1 ? " was" : "s were"} skipped because they are already in another campaign or have no LinkedIn profile.
        </p>
      )}
      <form action={excludeLeads}>
        <input type="hidden" name="id" value={c.id} />
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                {canExclude && <th className="w-10 px-4 py-3"><span className="sr-only">Select</span></th>}
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Next step</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ s, l, accountName }) => (
                <tr key={s.id}>
                  {canExclude && (
                    <td className="px-4 py-2.5">
                      {["pending", "active"].includes(s.status) && (
                        <input type="checkbox" name="leadStateId" value={s.id} aria-label={`Select ${l.firstName} ${l.lastName}`} />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{`${l.firstName} ${l.lastName}`.trim() || "Unnamed"}</span>
                    <div className="text-xs text-muted">{[l.title, l.company].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-4 py-2.5">{["completed", "replied", "skipped", "excluded"].includes(s.status) ? "—" : stepLabel(c, s.stepIndex)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_STATUS[s.status].tone}`}>{LEAD_STATUS[s.status].label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {accountName ?? (["pending", "active"].includes(s.status) ? "Assigned when sending starts" : "—")}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{s.note ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No leads with this status.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canExclude && (
          <ConfirmButton message="Exclude the selected leads from this campaign? They will not be contacted." className="btn btn-secondary mt-3">
            Exclude selected
          </ConfirmButton>
        )}
      </form>
      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
          {props.page > 1 && <Link href={href(props.page - 1)} className="btn btn-secondary">Previous</Link>}
          <span className="text-muted">Page {props.page} of {pages}</span>
          {props.page < pages && <Link href={href(props.page + 1)} className="btn btn-secondary">Next</Link>}
        </nav>
      )}
    </div>
  );
}
