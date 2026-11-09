import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { suppressedSql } from "../suppression";

/**
 * Adds the campaign's lead list to lead_state. Leads already enrolled are left alone.
 * A person already in another campaign (matched by LinkedIn id or profile slug) is
 * enrolled as "skipped", so two campaigns never contact the same person.
 */
export async function enrollLeads(campaignId: string, leadListId: string) {
  return db.transaction(async (tx) => {
    // One enrollment at a time across the app, so two launches cannot both claim a person.
    await tx.execute(sql`select pg_advisory_xact_lock(${ENROLL_LOCK})`);
    const result = await tx.execute(sql`
    insert into lead_state (campaign_id, lead_id, status, note)
    select ${campaignId}, l.id,
      case when ${suppressedSql("l")} then 'skipped'::lead_state_status
      when exists (
        select 1 from lead_state ls
        join leads o on o.id = ls.lead_id
        where ls.campaign_id <> ${campaignId}
          and ls.status <> 'skipped'
          and ((l.linkedin_id is not null and o.linkedin_id = l.linkedin_id)
            or (l.public_identifier is not null and o.public_identifier = l.public_identifier)
            or (l.provider_id is not null and o.provider_id = l.provider_id))
      ) then 'skipped'::lead_state_status
      when l.linkedin_id is null and l.public_identifier is null then 'skipped'::lead_state_status
      else 'pending'::lead_state_status end,
      case when ${suppressedSql("l")} then 'On the do-not-contact list'
      when exists (
        select 1 from lead_state ls
        join leads o on o.id = ls.lead_id
        where ls.campaign_id <> ${campaignId}
          and ls.status <> 'skipped'
          and ((l.linkedin_id is not null and o.linkedin_id = l.linkedin_id)
            or (l.public_identifier is not null and o.public_identifier = l.public_identifier)
            or (l.provider_id is not null and o.provider_id = l.provider_id))
      ) then 'Already in another campaign'
      when l.linkedin_id is null and l.public_identifier is null then 'No LinkedIn profile to contact'
      else null end
    from leads l
    where l.list_id = ${leadListId}
    order by l.seq
    on conflict (campaign_id, lead_id) do nothing
  `);
    return result.count ?? 0;
  });
}

const ENROLL_LOCK = 4_242_001;
