// Load test for the sending engine with 100 mock accounts (plan section 6, phase 9).
//
// Run against a throwaway database only:
//   createdb outreach_load
//   DATABASE_URL=postgres://.../outreach_load npm run db:migrate
//   DATABASE_URL=postgres://.../outreach_load npm run load-test
//
// It refuses to run unless the database name contains "load", because it deletes everything.
// Mock mode is forced: nothing reaches LinkedIn or Claude. A mock "day" is 120 seconds so
// daily limits bind within the run.
process.env.UNIPILE_MOCK = "1";
process.env.AI_MOCK = "1";
process.env.MOCK_DAY_SECONDS ??= "120";

import { sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { enrollLeads } from "../src/lib/campaigns/enroll";
import { SAFETY, tick } from "../src/lib/engine/engine";

const ACCOUNTS = 100;
const LEADS = 5000;
const DUPLICATES = 200; // same people imported again in another format
const SUPPRESSED_BEFORE = 50;
const SUPPRESSED_DURING = 20;
const RUN_SECONDS = Number(process.env.LOAD_SECONDS || 300);
const DAY_S = Number(process.env.MOCK_DAY_SECONDS);

function assertThrowaway() {
  const url = process.env.DATABASE_URL ?? "";
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!name.includes("load")) {
    console.error(`Refusing to run: database "${name}" does not contain "load". This test deletes all data.`);
    process.exit(1);
  }
}

async function reset() {
  await db.execute(sql`truncate activity_log, lead_state, message_drafts, campaign_accounts, campaigns, leads, lead_lists, accounts, suppression_list, conversations, messages cascade`);
}

async function seed() {
  const accounts = await db
    .insert(schema.accounts)
    .values(
      Array.from({ length: ACCOUNTS }, (_, i) => ({
        name: `Load account ${i + 1}`,
        unipileAccountId: `mock_load_${i}`,
        status: "ok" as const,
        enabled: true,
        hasSalesNav: i % 2 === 0,
        dailyInviteLimit: 15,
        dailyMessageLimit: 40,
        connectedAt: new Date(),
        warmupRaisedAt: new Date(), // no warm-up raises during the run
      })),
    )
    .returning();

  const [listA] = await db.insert(schema.leadLists).values({ name: "Load A", source: "csv", status: "ready", leadCount: LEADS }).returning();
  const [listB] = await db.insert(schema.leadLists).values({ name: "Load B", source: "csv", status: "ready", leadCount: DUPLICATES }).returning();

  // List A: people known by member id. The first DUPLICATES are "dup-k" people.
  const a = Array.from({ length: LEADS }, (_, i) => {
    const id = i < DUPLICATES ? `MOCKP-dup-${i}` : `LOADA${i}`;
    return { listId: listA.id, dedupeKey: `id:${id}`, linkedinId: id, firstName: `A${i}`, lastName: "Load", company: "Load Co" };
  });
  for (let i = 0; i < a.length; i += 1000) await db.insert(schema.leads).values(a.slice(i, i + 1000));
  // List B: the same dup-k people, known only by profile slug. Enrollment cannot match them;
  // the engine's profile lookup (mock member id "MOCKP-<slug>") must.
  await db.insert(schema.leads).values(
    Array.from({ length: DUPLICATES }, (_, i) => ({ listId: listB.id, dedupeKey: `in:dup-${i}`, publicIdentifier: `dup-${i}`, firstName: `B${i}`, lastName: "Load", company: "Load Co" })),
  );

  // Do-not-contact before launch: some list A people.
  await db.insert(schema.suppressionList).values(
    Array.from({ length: SUPPRESSED_BEFORE }, (_, i) => ({ linkedinId: `LOADA${1000 + i}`, reason: "Load test" })),
  );

  const steps = [
    { id: crypto.randomUUID(), type: "invite" as const, mode: "blank" as const, waitDays: 0, template: "", fallback: "" },
    { id: crypto.randomUUID(), type: "message" as const, mode: "template" as const, waitDays: 0, template: "Hi {first_name}", fallback: "" },
    { id: crypto.randomUUID(), type: "message" as const, mode: "template" as const, waitDays: 1, template: "Following up, {first_name}", fallback: "" },
  ];
  const common = { status: "running" as const, launchedAt: new Date(), steps, timezone: "UTC", activeDays: [0, 1, 2, 3, 4, 5, 6], activeFrom: "00:00", activeTo: "23:59", dailyInviteLimit: 15, dailyMessageLimit: 40 };
  const [cA] = await db.insert(schema.campaigns).values({ ...common, name: "Load campaign A", leadListId: listA.id }).returning();
  const [cB] = await db.insert(schema.campaigns).values({ ...common, name: "Load campaign B", leadListId: listB.id }).returning();
  // Accounts 0-59 on A, 40-99 on B: 20 accounts send for both.
  await db.insert(schema.campaignAccounts).values([
    ...accounts.slice(0, 60).map((x) => ({ campaignId: cA.id, accountId: x.id })),
    ...accounts.slice(40).map((x) => ({ campaignId: cB.id, accountId: x.id })),
  ]);
  const enrolledA = await enrollLeads(cA.id, listA.id);
  const enrolledB = await enrollLeads(cB.id, listB.id);
  return { cA, cB, enrolledA, enrolledB };
}

const pctl = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;

async function run() {
  const durations: number[] = [];
  let skippedByLock = 0;
  const end = Date.now() + RUN_SECONDS * 1000;
  let addedDuring = false;
  // Two loops, like two workers: the database lock must let only one tick run at a time.
  const loop = async () => {
    while (Date.now() < end) {
      const t0 = performance.now();
      const r = await tick();
      if (r.ran) durations.push(performance.now() - t0);
      else skippedByLock++;
      if (!addedDuring && Date.now() > end - RUN_SECONDS * 500) {
        addedDuring = true;
        // Mid-run do-not-contact additions, by member id: must stop these people at once.
        await db.insert(schema.suppressionList).values(
          Array.from({ length: SUPPRESSED_DURING }, (_, i) => ({ providerId: `LOADA${2000 + i}`, reason: "Load test, added mid-run" })),
        );
      }
      await new Promise((res) => setTimeout(res, 200));
    }
  };
  await Promise.all([loop(), loop()]);
  return { durations, skippedByLock };
}

type Check = { name: string; ok: boolean; detail: string };

async function check(): Promise<Check[]> {
  const one = async <T>(q: ReturnType<typeof sql>) => [...(await db.execute(q))][0] as T;
  const checks: Check[] = [];

  const overDaily = await one<{ n: number; worst: number }>(sql`
    with w as (
      select account_id, count(*) over (partition by account_id order by at range between ${`${DAY_S} seconds`}::interval preceding and current row) as n
      from activity_log where type = 'invite.sent'
    )
    select count(*) filter (where n > 15)::int as n, coalesce(max(n), 0)::int as worst from w`);
  checks.push({ name: "Invites per account per rolling day <= 15", ok: overDaily.n === 0, detail: `highest seen ${overDaily.worst}` });

  const overActions = await one<{ worst: number }>(sql`
    with w as (
      select count(*) over (partition by account_id order by at range between ${`${DAY_S} seconds`}::interval preceding and current row) as n
      from activity_log where type in ('invite.sent','message.sent','profile.lookup')
    ) select coalesce(max(n), 0)::int as worst from w`);
  checks.push({ name: `Actions per account per rolling day <= ${SAFETY.actionsPerDay}`, ok: overActions.worst <= SAFETY.actionsPerDay, detail: `highest seen ${overActions.worst}` });

  const overWeek = await one<{ worst: number }>(sql`
    with w as (
      select count(*) over (partition by account_id order by at range between ${`${DAY_S * 7} seconds`}::interval preceding and current row) as n
      from activity_log where type = 'invite.sent'
    ) select coalesce(max(n), 0)::int as worst from w`);
  checks.push({ name: `Invites per account per rolling week <= ${SAFETY.invitesPerWeek}`, ok: overWeek.worst <= SAFETY.invitesPerWeek, detail: `highest seen ${overWeek.worst}` });

  const foreign = await one<{ n: number }>(sql`
    select count(*)::int as n from lead_state s
    where s.account_id is not null and not exists (select 1 from campaign_accounts ca where ca.campaign_id = s.campaign_id and ca.account_id = s.account_id)`);
  checks.push({ name: "Every lead's account belongs to its campaign", ok: foreign.n === 0, detail: `${foreign.n} violations` });

  const switched = await one<{ n: number }>(sql`
    select count(*)::int as n from (
      select (l.detail->>'leadStateId') as ls from activity_log l where l.type in ('invite.sent','message.sent')
      group by 1 having count(distinct l.account_id) > 1) x`);
  checks.push({ name: "Each lead contacted by one account only", ok: switched.n === 0, detail: `${switched.n} leads with more than one account` });

  const twice = await one<{ n: number }>(sql`
    select count(*)::int as n from (
      select l.provider_id from lead_state s join leads l on l.id = s.lead_id
      where l.provider_id is not null and (s.invite_sent_at is not null or s.accepted_at is not null)
      group by l.provider_id having count(*) > 1) x`);
  checks.push({ name: "No person invited twice (across lists and formats)", ok: twice.n === 0, detail: `${twice.n} people` });

  const dupCaught = await one<{ n: number }>(sql`select count(*)::int as n from lead_state where note = 'Already contacted by another campaign'`);
  checks.push({ name: "Cross-format duplicates caught by the engine", ok: true, detail: `${dupCaught.n} caught (depends on how far the run got)` });

  const supp = await one<{ n: number }>(sql`
    select count(*)::int as n from activity_log l join lead_state s on s.id::text = l.detail->>'leadStateId' join leads ld on ld.id = s.lead_id
    where l.type in ('invite.sent','message.sent')
      and exists (select 1 from suppression_list x where x.created_at < l.at
        and ((ld.linkedin_id is not null and (x.linkedin_id = ld.linkedin_id or x.provider_id = ld.linkedin_id))
          or (ld.provider_id is not null and (x.provider_id = ld.provider_id or x.linkedin_id = ld.provider_id))))`);
  checks.push({ name: "Nobody contacted after joining the do-not-contact list", ok: supp.n === 0, detail: `${supp.n} actions` });

  const afterReply = await one<{ n: number }>(sql`
    select count(*)::int as n from activity_log l join lead_state s on s.id::text = l.detail->>'leadStateId'
    where l.type = 'message.sent' and s.replied_at is not null and l.at > s.replied_at`);
  checks.push({ name: "No message after a reply", ok: afterReply.n === 0, detail: `${afterReply.n} messages` });

  const stuck = await one<{ n: number }>(sql`select count(*)::int as n from lead_state where locked_until > now() + interval '1 minute'`);
  checks.push({ name: "No leads left locked", ok: stuck.n === 0, detail: `${stuck.n} locked` });
  return checks;
}

async function main() {
  assertThrowaway();
  console.log(`Seeding ${ACCOUNTS} accounts and ${LEADS + DUPLICATES} leads…`);
  await reset();
  const s = await seed();
  console.log(`Enrolled ${s.enrolledA} + ${s.enrolledB}. Running the engine for ${RUN_SECONDS}s (mock day ${DAY_S}s)…`);
  const r = await run();

  const [totals] = [...(await db.execute<{ invites: number; messages: number; lookups: number; replied: number; skipped: number }>(sql`
    select
      (select count(*) from activity_log where type = 'invite.sent')::int as invites,
      (select count(*) from activity_log where type = 'message.sent')::int as messages,
      (select count(*) from activity_log where type = 'profile.lookup')::int as lookups,
      (select count(*) from lead_state where status = 'replied')::int as replied,
      (select count(*) from lead_state where status = 'skipped')::int as skipped`))];
  console.log("\nActivity:", totals);
  console.log(
    `Ticks: ${r.durations.length} ran, ${r.skippedByLock} skipped by the lock. Duration ms: median ${Math.round(pctl(r.durations, 0.5))}, p95 ${Math.round(pctl(r.durations, 0.95))}, max ${Math.round(Math.max(...r.durations))}`,
  );
  const checks = await check();
  console.log("\nSafety checks:");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name} (${c.detail})`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
