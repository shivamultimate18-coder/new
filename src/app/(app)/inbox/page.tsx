import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import { INTENTS } from "@/db/schema";
import type { Intent } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { INTENT_LABEL } from "@/lib/inbox";
import { tagClass } from "@/lib/tag-colors";
import { ConfirmButton } from "@/components/confirm-button";
import { doNotContactConversation } from "../settings/actions";
import { markUnread, setIntent, toggleTag } from "./actions";
import { MarkRead, ReplyBox, SyncButton } from "./inbox-client";

export const instant = false;
export const metadata: Metadata = { title: "Inbox" };

const INTENT_TONE: Record<Intent, string> = {
  interested: "bg-emerald-50 text-emerald-800",
  maybe: "bg-amber-50 text-amber-800",
  not_interested: "bg-zinc-100 text-zinc-700",
  pitching_us: "bg-violet-50 text-violet-800",
  needs_human: "bg-red-50 text-red-800",
};
const PER_PAGE = 50;

function IntentBadge({ intent, manual }: { intent: Intent | null; manual?: boolean }) {
  if (!intent) return null;
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${INTENT_TONE[intent]}`} title={manual ? "Set by a teammate" : "Set by AI"}>
      {INTENT_LABEL[intent]}
    </span>
  );
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const accountId = /^[0-9a-f-]{36}$/i.test(str("account")) ? str("account") : null;
  const campaignId = /^[0-9a-f-]{36}$/i.test(str("campaign")) ? str("campaign") : null;
  const intent = (INTENTS as readonly string[]).includes(str("intent")) ? (str("intent") as Intent) : null;
  const unreadOnly = str("unread") === "1";
  const q = str("q").trim();
  const page = Math.max(1, Number(str("page")) || 1);
  const openId = /^[0-9a-f-]{36}$/i.test(str("c")) ? str("c") : null;

  const href = (patch: Record<string, string | null>) => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries({ account: accountId, campaign: campaignId, intent, unread: unreadOnly ? "1" : null, q: q || null, c: openId })) if (v) base[k] = v;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete base[k];
      else base[k] = v;
    }
    const s = new URLSearchParams(base).toString();
    return `/inbox${s ? `?${s}` : ""}`;
  };

  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const where = and(
    sql`${schema.conversations.lastMessageAt} is not null`,
    accountId ? eq(schema.conversations.accountId, accountId) : undefined,
    campaignId ? eq(schema.leadState.campaignId, campaignId) : undefined,
    intent ? eq(schema.conversations.intent, intent) : undefined,
    unreadOnly ? eq(schema.conversations.unread, true) : undefined,
    q ? or(ilike(schema.conversations.prospectName, like), ilike(schema.leads.company, like), ilike(schema.conversations.lastMessagePreview, like)) : undefined,
  );

  const [accounts, campaigns, tags, rows, [{ n: total }], intentCounts] = await Promise.all([
    db.select().from(schema.accounts).orderBy(asc(schema.accounts.createdAt)),
    db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name)),
    db.select().from(schema.tags).orderBy(asc(schema.tags.name)),
    db
      .select({ conv: schema.conversations, company: schema.leads.company, title: schema.leads.title })
      .from(schema.conversations)
      .leftJoin(schema.leadState, eq(schema.leadState.id, schema.conversations.leadStateId))
      .leftJoin(schema.leads, eq(schema.leads.id, schema.conversations.leadId))
      .where(where)
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    db
      .select({ n: count() })
      .from(schema.conversations)
      .leftJoin(schema.leadState, eq(schema.leadState.id, schema.conversations.leadStateId))
      .leftJoin(schema.leads, eq(schema.leads.id, schema.conversations.leadId))
      .where(where),
    db
      .select({ intent: schema.conversations.intent, n: count() })
      .from(schema.conversations)
      .where(and(sql`${schema.conversations.lastMessageAt} is not null`, accountId ? eq(schema.conversations.accountId, accountId) : undefined))
      .groupBy(schema.conversations.intent),
  ]);
  const convTags = rows.length
    ? await db
        .select({ conversationId: schema.conversationTags.conversationId, tag: schema.tags })
        .from(schema.conversationTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.conversationTags.tagId))
        .where(inArray(schema.conversationTags.conversationId, [...rows.map((r) => r.conv.id), ...(openId ? [openId] : [])]))
    : [];
  const tagsOf = (id: string) => convTags.filter((t) => t.conversationId === id).map((t) => t.tag);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name || "LinkedIn account";
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const countOf = (i: Intent) => intentCounts.find((r) => r.intent === i)?.n ?? 0;

  return (
    <div className="max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inbox</h1>
          <p className="mt-1 text-sm text-muted">
            {accountId ? accountName(accountId) : "All accounts"} · {total.toLocaleString()} conversation{total === 1 ? "" : "s"}
          </p>
        </div>
        <SyncButton />
      </div>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Accounts">
        <Link href={href({ account: null, page: null, c: null })} aria-current={!accountId ? "page" : undefined} className={`btn px-3 py-1.5 ${!accountId ? "btn-primary" : "btn-secondary"}`}>All accounts</Link>
        {accounts.map((a) => (
          <Link key={a.id} href={href({ account: a.id, page: null, c: null })} aria-current={accountId === a.id ? "page" : undefined} className={`btn px-3 py-1.5 ${accountId === a.id ? "btn-primary" : "btn-secondary"}`}>
            {a.name || "LinkedIn account"}
          </Link>
        ))}
      </nav>

      <form className="mt-3 flex flex-wrap items-center gap-2" role="search">
        {accountId && <input type="hidden" name="account" value={accountId} />}
        {intent && <input type="hidden" name="intent" value={intent} />}
        <input name="q" defaultValue={q} placeholder="Search name, company or message" className="input max-w-xs" aria-label="Search" />
        <select name="campaign" defaultValue={campaignId ?? ""} className="input max-w-xs" aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} /> Unread only
        </label>
        <button type="submit" className="btn btn-secondary">Filter</button>
      </form>

      <nav className="mt-3 flex flex-wrap gap-2" aria-label="Intent">
        <Link href={href({ intent: null, page: null })} aria-current={!intent ? "page" : undefined} className={`btn px-3 py-1 text-xs ${!intent ? "btn-primary" : "btn-secondary"}`}>All</Link>
        {INTENTS.map((i) => (
          <Link key={i} href={href({ intent: i, page: null })} aria-current={intent === i ? "page" : undefined} className={`btn px-3 py-1 text-xs ${intent === i ? "btn-primary" : "btn-secondary"}`}>
            {INTENT_LABEL[i]} <span className="tabular-nums">({countOf(i)})</span>
          </Link>
        ))}
      </nav>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <section aria-label="Conversations" className={openId ? "hidden lg:block" : ""}>
          <ul className="card divide-y divide-line overflow-hidden">
            {rows.map(({ conv, company, title }) => (
              <li key={conv.id}>
                <Link href={href({ c: conv.id })} scroll={false} className={`block px-4 py-3 hover:bg-canvas ${openId === conv.id ? "bg-brand/5" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`min-w-0 truncate ${conv.unread ? "font-semibold" : "font-medium"}`}>
                      {conv.unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" aria-label="Unread" />}
                      {conv.prospectName || "Unknown prospect"}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{ago(conv.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{[title, company].filter(Boolean).join(" · ") || accountName(conv.accountId)}</span>
                    <IntentBadge intent={conv.intent} manual={conv.intentSource === "manual"} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {conv.lastFromProspect ? "" : "You: "}
                    {conv.lastMessagePreview}
                  </p>
                  {tagsOf(conv.id).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tagsOf(conv.id).map((t) => <span key={t.id} className={`rounded-full px-2 py-0.5 text-xs ${tagClass(t.color)}`}>{t.name}</span>)}
                    </div>
                  )}
                </Link>
              </li>
            ))}
            {rows.length === 0 && <li className="p-8 text-center text-sm text-muted">No conversations match.</li>}
          </ul>
          {pages > 1 && (
            <nav className="mt-3 flex items-center gap-3 text-sm" aria-label="Pages">
              {page > 1 && <Link href={href({ page: String(page - 1) })} className="btn btn-secondary">Previous</Link>}
              <span className="text-muted">Page {page} of {pages}</span>
              {page < pages && <Link href={href({ page: String(page + 1) })} className="btn btn-secondary">Next</Link>}
            </nav>
          )}
        </section>

        <section aria-label="Conversation" className={openId ? "" : "hidden lg:block"}>
          {openId ? (
            <Thread id={openId} userId={user.id} isAdmin={user.role === "admin"} backHref={href({ c: null })} tags={tags} activeTags={tagsOf(openId).map((t) => t.id)} />
          ) : (
            <div className="card flex h-64 items-center justify-center p-8 text-sm text-muted">Choose a conversation.</div>
          )}
        </section>
      </div>
    </div>
  );
}

async function Thread(props: {
  id: string;
  userId: string;
  isAdmin: boolean;
  backHref: string;
  tags: (typeof schema.tags.$inferSelect)[];
  activeTags: string[];
}) {
  const [row] = await db
    .select({ conv: schema.conversations, account: schema.accounts, campaign: schema.campaigns, s: schema.leadState })
    .from(schema.conversations)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.conversations.accountId))
    .leftJoin(schema.leadState, eq(schema.leadState.id, schema.conversations.leadStateId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leadState.campaignId))
    .where(eq(schema.conversations.id, props.id));
  if (!row) return <div className="card p-8 text-sm text-muted">This conversation no longer exists.</div>;
  const { conv, account } = row;
  const msgs = await db
    .select({ m: schema.messages, by: schema.users.name })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.users.id, schema.messages.sentByUserId))
    .where(eq(schema.messages.conversationId, conv.id))
    .orderBy(asc(schema.messages.sentAt));
  const name = conv.prospectName || "Unknown prospect";
  const accountName = account.name || "LinkedIn account";
  const canSend = props.isAdmin || account.ownerUserId === props.userId;

  return (
    <div className="card flex flex-col">
      <MarkRead id={conv.id} unread={conv.unread} />
      <header className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={props.backHref} scroll={false} className="mb-1 inline-block text-sm text-muted hover:text-ink lg:hidden">← Conversations</Link>
            <h2 className="truncate font-medium">{name}</h2>
            {conv.prospectHeadline && <p className="text-sm text-muted">{conv.prospectHeadline}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-canvas px-2 py-0.5 text-muted">Account · {accountName}</span>
              {row.campaign && <Link href={`/campaigns/${row.campaign.id}`} className="rounded-full bg-canvas px-2 py-0.5 text-muted hover:text-ink">Campaign · {row.campaign.name}</Link>}
              {conv.prospectProfileUrl && <a href={conv.prospectProfileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">LinkedIn profile</a>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={markUnread}>
              <input type="hidden" name="id" value={conv.id} />
              <button type="submit" className="btn btn-secondary px-2.5 py-1 text-xs">Mark unread</button>
            </form>
            <form action={doNotContactConversation}>
              <input type="hidden" name="id" value={conv.id} />
              <ConfirmButton message={`Add ${name} to the do-not-contact list? No campaign will message them again.`} className="btn btn-danger px-2.5 py-1 text-xs">
                Do not contact
              </ConfirmButton>
            </form>
          </div>
        </div>
        <form action={setIntent} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={conv.id} />
          <label htmlFor="intent" className="text-sm font-medium">Intent</label>
          <select id="intent" name="intent" defaultValue={conv.intentSource === "manual" ? (conv.intent ?? "auto") : "auto"} className="input w-auto py-1.5" key={`${conv.intent}-${conv.intentSource}`}>
            <option value="auto">Automatic{conv.intentSource !== "manual" && conv.intent ? ` (${INTENT_LABEL[conv.intent]})` : ""}</option>
            {INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
          </select>
          <button type="submit" className="btn btn-secondary px-2.5 py-1.5 text-xs">Set</button>
          <IntentBadge intent={conv.intent} manual={conv.intentSource === "manual"} />
          <span className="text-xs text-muted">{conv.intentSource === "manual" ? "Set by a teammate; the AI will not change it." : conv.intentReason ?? (conv.intent ? "" : "Labelled when the prospect writes.")}</span>
        </form>
        {props.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
            {props.tags.map((t) => {
              const on = props.activeTags.includes(t.id);
              return (
                <form key={t.id} action={toggleTag}>
                  <input type="hidden" name="id" value={conv.id} />
                  <input type="hidden" name="tagId" value={t.id} />
                  <button type="submit" aria-pressed={on} className={`rounded-full px-2.5 py-0.5 text-xs ${on ? tagClass(t.color) : "border border-dashed border-line text-muted hover:text-ink"}`}>
                    {on ? t.name : `+ ${t.name}`}
                  </button>
                </form>
              );
            })}
          </div>
        )}
      </header>

      <ol className="space-y-3 p-4" aria-label="Messages">
        {msgs.map(({ m, by }) => {
          const mine = m.direction === "out";
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${mine ? "bg-brand/10" : "bg-canvas"}`}>
                <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                <p className="mt-1 text-xs text-muted">
                  {mine ? `${accountName} sent${m.source === "campaign" ? " (campaign)" : m.source === "inbox" ? ` (by ${by ?? "a teammate"})` : ""}` : `${name.split(" ")[0]} replied`} · {ago(m.sentAt)}
                </p>
              </div>
            </li>
          );
        })}
        {msgs.length === 0 && <li className="text-sm text-muted">No messages stored yet. Try Sync.</li>}
      </ol>

      <footer className="border-t border-line p-4">
        <ReplyBox id={conv.id} canSend={canSend} accountName={accountName} />
      </footer>
    </div>
  );
}
