import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ConfirmButton } from "@/components/confirm-button";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { renderTemplate } from "@/lib/campaigns/template";
import { messageSteps } from "@/lib/drafting";
import { ROLE_LABEL } from "@/lib/voice/compose";
import { approveLeads, excludeFromReview, unapproveLead } from "./actions";
import { DraftEditor, RegenerateBox, TeachStyleBox } from "./review-client";

export const instant = false;
export const metadata: Metadata = { title: "Message Review" };

const TABS = [
  { id: "review", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const PER_PAGE = 50;

const hasDraft = (status: string) =>
  sql`exists (select 1 from message_drafts d where d.lead_state_id = ${schema.leadState.id} and d.status = ${status})`;

function tabWhere(tab: Tab) {
  if (tab === "review") return and(inArray(schema.leadState.status, ["pending", "active"]), hasDraft("drafted"));
  if (tab === "approved") return and(inArray(schema.leadState.status, ["pending", "active"]), hasDraft("approved"), sql`not ${hasDraft("drafted")}`);
  return hasDraft("sent");
}

function FitBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted">—</span>;
  const tone = score >= 4 ? "bg-emerald-50 text-emerald-800" : score === 3 ? "bg-zinc-100 text-zinc-700" : "bg-red-50 text-red-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`} title="Fit with the product, 1 to 5">{score}/5</span>;
}

export default async function MessageReviewPage({ searchParams }: PageProps<"/message-review">) {
  await requireUser();
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t.id === sp.tab)?.id ?? "review";
  const campaignId = typeof sp.campaign === "string" && /^[0-9a-f-]{36}$/i.test(sp.campaign) ? sp.campaign : null;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const open = typeof sp.lead === "string" && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : null;

  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const where = and(
    tabWhere(tab),
    campaignId ? eq(schema.leadState.campaignId, campaignId) : undefined,
    q ? or(ilike(schema.leads.firstName, like), ilike(schema.leads.lastName, like), ilike(schema.leads.company, like)) : undefined,
  );
  const lastSent = sql<Date>`(select max(d.sent_at) from message_drafts d where d.lead_state_id = ${schema.leadState.id} and d.status = 'sent')`;
  const [rows, counts, campaigns] = await Promise.all([
    db
      .select({
        s: schema.leadState,
        lead: schema.leads,
        campaignName: schema.campaigns.name,
        warnings: sql<number>`(select count(*)::int from message_drafts d where d.lead_state_id = ${schema.leadState.id} and d.status in ('drafted','approved') and jsonb_array_length(d.warnings) > 0)`,
        lastSent,
      })
      .from(schema.leadState)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
      .where(where)
      // Leads the engine is holding for approval first: they are ready to send now.
      .orderBy(
        ...(tab === "sent"
          ? [desc(lastSent)]
          : [sql`case when ${schema.leadState.waiting} = 'approval' then 0 else 1 end`, asc(schema.leadState.draftedAt)]),
      )
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    Promise.all(
      TABS.map(async (t) => {
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.leadState)
          .where(and(tabWhere(t.id), campaignId ? eq(schema.leadState.campaignId, campaignId) : undefined));
        return [t.id, n] as const;
      }),
    ),
    db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name)),
  ]);
  const count = Object.fromEntries(counts) as Record<Tab, number>;
  const pages = Math.max(1, Math.ceil(count[tab] / PER_PAGE));
  const params = (patch: Record<string, string | null>) => {
    const base: Record<string, string> = { ...(tab !== "review" ? { tab } : {}), ...(campaignId ? { campaign: campaignId } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete base[k];
      else base[k] = v;
    }
    const s = new URLSearchParams(base).toString();
    return `/message-review${s ? `?${s}` : ""}`;
  };
  const ids = rows.map((r) => r.s.id);

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold">Message Review</h1>
      <p className="mt-1 text-sm text-muted">
        {count.review.toLocaleString()} lead{count.review === 1 ? "" : "s"} waiting for review. Drafts are written once a lead accepts the connection request.
      </p>

      <nav className="mt-5 flex gap-1 border-b border-line" aria-label="Queues">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={params({ tab: t.id === "review" ? null : t.id, page: null, lead: null })}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label} <span className="tabular-nums">({count[t.id].toLocaleString()})</span>
          </Link>
        ))}
      </nav>

      <form className="mt-4 flex flex-wrap gap-2" role="search">
        {tab !== "review" && <input type="hidden" name="tab" value={tab} />}
        <input name="q" defaultValue={q} placeholder="Search by name or company" className="input max-w-xs" aria-label="Search" />
        <select name="campaign" defaultValue={campaignId ?? ""} className="input max-w-xs" aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="btn btn-secondary">Filter</button>
      </form>

      <form action={approveLeads}>
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                {tab === "review" && <th className="w-10 px-4 py-3"><span className="sr-only">Select</span></th>}
                <th className="px-4 py-3 font-medium">Prospect</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Fit</th>
                <th className="px-4 py-3 font-medium">{tab === "sent" ? "Last sent" : "Drafted"}</th>
                <th className="px-4 py-3 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ s, lead, campaignName, warnings, lastSent: sentAt }) => (
                <tr key={s.id} className={open === s.id ? "bg-brand/5" : "hover:bg-canvas"}>
                  {tab === "review" && (
                    <td className="px-4 py-2.5">
                      <input type="checkbox" name="leadStateId" value={s.id} aria-label={`Select ${lead.firstName} ${lead.lastName}`} />
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <Link href={params({ lead: s.id })} scroll={false} className="font-medium hover:underline">
                      {`${lead.firstName} ${lead.lastName}`.trim()}
                    </Link>
                    <div className="text-xs text-muted">{[lead.title, lead.company].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{campaignName}</td>
                  <td className="px-4 py-2.5"><FitBadge score={s.fitScore} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{tab === "sent" ? (sentAt ? ago(new Date(sentAt)) : "") : ago(s.draftedAt)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {warnings > 0 && <span className="mr-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">{warnings} rule warning{warnings === 1 ? "" : "s"}</span>}
                    {s.waiting === "approval" && tab !== "sent" && <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-800">Due now</span>}
                    {tab === "sent" && <span className="text-muted">{s.status === "replied" ? "Replied" : s.note}</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {tab === "review" ? "Nothing to review. Drafts appear here when leads accept your invites." : tab === "approved" ? "No approved messages waiting to send." : "No messages sent yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {tab === "review" && rows.length > 0 && (
          <button type="submit" className="btn btn-primary mt-3">Approve selected</button>
        )}
      </form>

      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
          {page > 1 && <Link href={params({ page: String(page - 1), lead: null })} className="btn btn-secondary">Previous</Link>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <Link href={params({ page: String(page + 1), lead: null })} className="btn btn-secondary">Next</Link>}
        </nav>
      )}

      {open && <LeadDrawer id={open} closeHref={params({ lead: null })} prevHref={ids.indexOf(open) > 0 ? params({ lead: ids[ids.indexOf(open) - 1] }) : null} nextHref={ids.indexOf(open) >= 0 && ids.indexOf(open) < ids.length - 1 ? params({ lead: ids[ids.indexOf(open) + 1] }) : null} />}
    </div>
  );
}

async function LeadDrawer(props: { id: string; closeHref: string; prevHref: string | null; nextHref: string | null }) {
  const [row] = await db
    .select({ s: schema.leadState, lead: schema.leads, c: schema.campaigns, accountName: schema.accounts.name })
    .from(schema.leadState)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.leadState.leadId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.leadState.accountId))
    .where(eq(schema.leadState.id, props.id));
  if (!row) notFound();
  const { s, lead, c } = row;
  const drafts = await db
    .select()
    .from(schema.messageDrafts)
    .where(and(eq(schema.messageDrafts.leadStateId, s.id), inArray(schema.messageDrafts.status, ["drafted", "approved", "sent"])))
    .orderBy(asc(schema.messageDrafts.stepIndex));
  const steps = messageSteps(c);
  const hasDrafted = drafts.some((d) => d.status === "drafted");
  const hasApproved = drafts.some((d) => d.status === "approved");
  const active = ["pending", "active"].includes(s.status);
  const profile = (lead.profile ?? {}) as Record<string, unknown>;
  const name = `${lead.firstName} ${lead.lastName}`.trim();

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/20" role="dialog" aria-modal="true" aria-label={`Messages for ${name}`}>
      <Link href={props.closeHref} scroll={false} className="hidden flex-1 md:block" aria-label="Close" />
      <div className="flex h-full w-full max-w-5xl flex-col overflow-y-auto bg-canvas shadow-xl">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <Link href={props.closeHref} scroll={false} className="btn btn-secondary px-2.5 py-1" aria-label="Close">✕</Link>
          {props.prevHref ? <Link href={props.prevHref} scroll={false} className="btn btn-secondary px-2.5 py-1" aria-label="Previous lead">↑</Link> : <span className="btn btn-secondary px-2.5 py-1 opacity-40" aria-hidden>↑</span>}
          {props.nextHref ? <Link href={props.nextHref} scroll={false} className="btn btn-secondary px-2.5 py-1" aria-label="Next lead">↓</Link> : <span className="btn btn-secondary px-2.5 py-1 opacity-40" aria-hidden>↓</span>}
          <span className="min-w-0 flex-1 truncate font-medium">{name} <span className="font-normal text-muted">· {c.name}</span></span>
          {active && hasDrafted && (
            <form action={approveLeads}>
              <input type="hidden" name="leadStateId" value={s.id} />
              <button type="submit" className="btn btn-primary">Approve</button>
            </form>
          )}
          {active && !hasDrafted && hasApproved && (
            <form action={unapproveLead}>
              <input type="hidden" name="leadStateId" value={s.id} />
              <button type="submit" className="btn btn-secondary">Move back to review</button>
            </form>
          )}
        </div>

        <div className="grid gap-6 p-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            {s.draftError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Drafting problem: {s.draftError}</p>}
            {steps.map(({ step, stepIndex, role }, k) => {
              const d = drafts.find((x) => x.stepIndex === stepIndex);
              const sent = d?.status === "sent" || (step.mode === "template" && stepIndex < s.stepIndex);
              const badge = d?.status === "sent" ? ["Sent", "bg-emerald-50 text-emerald-800"] : d?.status === "approved" ? ["Approved", "bg-blue-50 text-blue-800"] : d?.status === "drafted" ? ["Needs review", "bg-amber-50 text-amber-800"] : step.mode === "template" ? [sent ? "Sent (template)" : "Template", "bg-zinc-100 text-zinc-700"] : ["Not drafted yet", "bg-zinc-100 text-zinc-700"];
              return (
                <section key={step.id} className="card p-4" aria-label={`Message ${k + 1}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">Message {k + 1} · {ROLE_LABEL[role]}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {k === 0 ? `${step.waitDays} day${step.waitDays === 1 ? "" : "s"} after acceptance` : `${step.waitDays} day${step.waitDays === 1 ? "" : "s"} later if no reply`}
                      <span className={`rounded-full px-2 py-0.5 font-medium ${badge[1]}`}>{badge[0]}</span>
                    </span>
                  </div>
                  {d ? (
                    d.status === "sent" ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{d.body}<span className="mt-2 block text-xs text-muted">Sent {ago(d.sentAt)} · locked</span></p>
                    ) : (
                      <DraftEditor id={d.id} body={d.body} warnings={d.warnings} locked={!active} />
                    )
                  ) : step.mode === "template" ? (
                    <p className="whitespace-pre-wrap rounded bg-canvas p-2 text-sm text-muted">
                      {renderTemplate(step.template, step.fallback, { first_name: lead.firstName, last_name: lead.lastName, company: lead.company, title: lead.title }) ??
                        "Skipped for this lead: the template needs details the lead does not have."}
                    </p>
                  ) : (
                    <p className="text-sm text-muted">{active ? "Drafted after the lead accepts the connection request." : "Not drafted."}</p>
                  )}
                </section>
              );
            })}
            {active && drafts.some((d) => d.status !== "sent") && (
              <div className="card grid gap-6 p-4 md:grid-cols-2">
                <RegenerateBox leadStateId={s.id} />
                <TeachStyleBox leadStateId={s.id} />
              </div>
            )}
            {active && (
              <form action={excludeFromReview}>
                <input type="hidden" name="leadStateId" value={s.id} />
                <ConfirmButton message={`Exclude ${name} from this campaign? Nothing more will be sent.`} className="btn btn-danger">Exclude lead</ConfirmButton>
              </form>
            )}
          </div>

          <aside className="card h-fit space-y-3 p-4 text-sm" aria-label="Lead details">
            <div>
              <div className="font-medium">{name}</div>
              {lead.headline && <div className="text-muted">{lead.headline}</div>}
              {lead.profileUrl && <a href={lead.profileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">LinkedIn profile</a>}
            </div>
            <div>
              <div className="text-xs text-muted">Fit with the product</div>
              <div className="flex items-center gap-2"><FitBadge score={s.fitScore} /></div>
              {s.fitReason && <p className="mt-1 text-muted">{s.fitReason}</p>}
            </div>
            {s.angle && (
              <div>
                <div className="text-xs text-muted">Angle</div>
                <p>{s.angle}</p>
              </div>
            )}
            <dl className="space-y-2">
              {[
                ["Title", lead.title],
                ["Company", lead.company],
                ["Location", lead.location ?? (profile.location as string | undefined)],
                ["Industry", lead.industry],
                ["Campaign", c.name],
                ["Sending account", row.accountName],
                ["Status", s.note],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {typeof profile.summary === "string" && profile.summary && (
              <details>
                <summary className="cursor-pointer text-xs text-muted">About</summary>
                <p className="mt-1 whitespace-pre-wrap">{profile.summary}</p>
              </details>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
