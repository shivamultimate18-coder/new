import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "./env";

/**
 * Numbers for Home and campaign pages.
 *
 * Daily counts come from the activity log (what happened each day). Rates are measured on a
 * cohort, the leads invited in the period, so they can never pass 100%:
 *   acceptance rate = accepted / invited, reply rate = replied / accepted.
 */

export const RANGES = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;
export const parseRange = (v: unknown): RangeKey => (typeof v === "string" && v in RANGES ? (v as RangeKey) : "14d");

export type Scope = { days: number; campaignId?: string | null };

export type Daily = { day: string; invites: number; accepted: number; messages: number; replies: number };
export type Totals = {
  invites: number;
  accepted: number;
  messages: number;
  replies: number;
  cohortInvited: number;
  cohortAccepted: number;
  cohortReplied: number;
  interested: number;
};
export type Breakdown = { id: string; name: string; invited: number; accepted: number; messages: number; replied: number };

const rangeStart = (days: number) => sql`(date_trunc('day', now() at time zone ${env.APP_TIMEZONE}) - make_interval(days => ${days - 1})) at time zone ${env.APP_TIMEZONE}`;
const campaignFilter = (campaignId?: string | null, column = sql`l.detail->>'campaignId'`) =>
  campaignId ? sql`and ${column} = ${campaignId}` : sql``;

export async function dailySeries(s: Scope): Promise<Daily[]> {
  const tz = env.APP_TIMEZONE;
  const rows = await db.execute<{ day: string; invites: number; accepted: number; messages: number; replies: number }>(sql`
    with days as (
      select generate_series(
        date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${s.days - 1}),
        date_trunc('day', now() at time zone ${tz}),
        interval '1 day'
      )::date as day
    ),
    events as (
      select (l.at at time zone ${tz})::date as day, l.type
      from activity_log l
      where l.at >= ${rangeStart(s.days)}
        and l.type in ('invite.sent', 'invite.accepted', 'message.sent', 'lead.replied')
        and coalesce(l.detail->>'manual', 'false') <> 'true'
        and coalesce(l.detail->>'alreadyPending', 'false') <> 'true'
        ${campaignFilter(s.campaignId)}
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      count(e.*) filter (where e.type = 'invite.sent')::int as invites,
      count(e.*) filter (where e.type = 'invite.accepted')::int as accepted,
      count(e.*) filter (where e.type = 'message.sent')::int as messages,
      count(e.*) filter (where e.type = 'lead.replied')::int as replies
    from days d left join events e on e.day = d.day
    group by d.day order by d.day
  `);
  return [...rows];
}

export async function totals(s: Scope): Promise<Totals> {
  const [ev] = await db.execute<{ invites: number; accepted: number; messages: number; replies: number }>(sql`
    select
      count(*) filter (where l.type = 'invite.sent' and coalesce(l.detail->>'alreadyPending','false') <> 'true')::int as invites,
      count(*) filter (where l.type = 'invite.accepted')::int as accepted,
      count(*) filter (where l.type = 'message.sent' and coalesce(l.detail->>'manual','false') <> 'true')::int as messages,
      count(*) filter (where l.type = 'lead.replied')::int as replies
    from activity_log l
    where l.at >= ${rangeStart(s.days)} ${campaignFilter(s.campaignId)}
  `);
  const [co] = await db.execute<{ invited: number; accepted: number; replied: number }>(sql`
    select count(*)::int as invited,
      count(*) filter (where s.accepted_at is not null)::int as accepted,
      count(*) filter (where s.replied_at is not null and s.accepted_at is not null)::int as replied
    from lead_state s
    where coalesce(s.invite_sent_at, s.accepted_at) >= ${rangeStart(s.days)}
      ${campaignFilter(s.campaignId, sql`s.campaign_id::text`)}
  `);
  const [int] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from conversations c
    left join lead_state s on s.id = c.lead_state_id
    where c.intent = 'interested' and c.last_message_at >= ${rangeStart(s.days)}
      ${campaignFilter(s.campaignId, sql`s.campaign_id::text`)}
  `);
  return {
    ...ev,
    cohortInvited: co.invited,
    cohortAccepted: co.accepted,
    cohortReplied: co.replied,
    interested: int.n,
  };
}

/** Per account or per campaign: rates on the same cohort as above, messages as sent in the period. */
export async function breakdown(s: Scope, by: "account" | "campaign"): Promise<Breakdown[]> {
  const key = by === "account" ? sql`s.account_id` : sql`s.campaign_id`;
  const name = by === "account" ? sql`coalesce(nullif(a.name, ''), 'LinkedIn account')` : sql`c.name`;
  const cohort = await db.execute<Omit<Breakdown, "messages">>(sql`
    select ${key}::text as id, ${name} as name,
      count(*)::int as invited,
      count(*) filter (where s.accepted_at is not null)::int as accepted,
      count(*) filter (where s.replied_at is not null and s.accepted_at is not null)::int as replied
    from lead_state s
    join campaigns c on c.id = s.campaign_id
    left join accounts a on a.id = s.account_id
    where coalesce(s.invite_sent_at, s.accepted_at) >= ${rangeStart(s.days)}
      and ${key} is not null
      ${campaignFilter(s.campaignId, sql`s.campaign_id::text`)}
    group by ${key}, ${name}
    order by invited desc
  `);
  const msgKey = by === "account" ? sql`l.account_id::text` : sql`l.detail->>'campaignId'`;
  const sent = await db.execute<{ id: string; n: number }>(sql`
    select ${msgKey} as id, count(*)::int as n
    from activity_log l
    where l.type = 'message.sent' and coalesce(l.detail->>'manual', 'false') <> 'true'
      and l.at >= ${rangeStart(s.days)} ${campaignFilter(s.campaignId)}
    group by 1
  `);
  const byId = new Map([...sent].map((r) => [r.id, r.n]));
  return [...cohort].map((r) => ({ ...r, messages: byId.get(r.id) ?? 0 }));
}

export const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);
export const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
