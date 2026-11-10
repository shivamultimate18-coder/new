# Outreach (working name)

Self-hosted multi-account LinkedIn outreach tool. The plan is in
[docs/ACTION_PLAN.md](docs/ACTION_PLAN.md); the feature reference is
[docs/sendroq-scrape.md](docs/sendroq-scrape.md) (used to understand the features only; all
wording and design here are our own).

## Status: Phases 1 to 9 done

Phase 9, hardening for 100 accounts:

- **Do not contact** (Settings): a team-wide list matched on any LinkedIn identifier
  (member id, Sales Navigator id, profile slug). Checked at import, at enrollment, before
  every invite and before every message; adding someone stops them in every running
  campaign. Add by pasting links, or with "Do not contact" on an Inbox conversation.
- **Duplicates across formats:** the profile lookup before an invite reveals the real
  member id; the engine then checks, under a lock on that id, that no other campaign or
  list has contacted the person, so the same person imported as a Sales Navigator id and
  as a profile slug is invited once.
- **Privacy deletion** (admins, Settings > Do not contact): removes a person's leads,
  campaign progress, drafts, conversations and messages, keeping only their LinkedIn
  identifiers on the do-not-contact list so they are not imported again.
- **AI spend cap** (Settings > AI usage): admins set a monthly limit; spend is estimated
  from stored token counts at list prices. Every Claude call checks it first; at the limit,
  drafting, labels and suggested replies pause with a clear message, and Home warns from 80%.
- **Account health** (Accounts > Account health): every account with its status, rolling
  24-hour and 7-day usage against each limit, 14-day acceptance rate, queue and problems,
  problem accounts first. Low acceptance (under 15% of 20+ invites) is flagged as an early
  sign of LinkedIn limiting the account.
- **Load test** (`npm run load-test`, throwaway database only): 100 mock accounts, 5,200
  leads (200 duplicated in another format), two overlapping campaigns, do-not-contact
  entries before and during the run, two engine loops at once. It checks every safety
  rule; see "Load test" below.

Phase 8, Home and campaign analytics (`src/lib/analytics.ts`, `src/components/performance.tsx`):

- **Home:** "Needs attention" (accounts, drafts waiting, replies to answer), then
  Performance for the last 7, 14, 30 or 90 days, for all campaigns or one: invites sent,
  accepted with acceptance rate, messages sent, replies with reply rate, and conversations
  labelled Interested; a daily line chart; and tables by campaign and by account.
- **Campaigns:** a Performance tab on each campaign, and acceptance and reply rates on the
  campaign cards.
- **How rates are counted:** on the leads invited in the period (or connected already), so
  they never pass 100%: acceptance = accepted / invited, reply rate = replied / accepted.
  Daily counts are what happened each day. Manual inbox replies are not counted as
  campaign messages.
- Days follow `APP_TIMEZONE` (default UTC).
- The chart is hand-built SVG: one axis, a crosshair tooltip that lists every series,
  arrow-key reading, labels at the line ends, a legend, and a table view. Its colours were
  run through a colour-blindness and contrast validator.

Phase 7, Inbox (`/inbox`, `src/lib/inbox.ts`):

- Every account's conversations in one place. Campaign messages are filed as they are
  sent; replies arrive by the `message_received` webhook (also messages the team sends from
  LinkedIn directly, and chats outside any campaign); **Sync** pulls each account's recent
  chats from Unipile to fill gaps. Duplicate webhook deliveries are stored once.
- **Intent:** Interested, Maybe, Not interested, Pitching us, Needs human. Claude Haiku 5.5
  reads the whole thread, and only when the prospect writes (debounced per conversation, so a
  burst is classified once). A label set by a teammate is never overwritten; "Automatic"
  hands it back to the AI.
- Filters by account, campaign, intent, unread and text; unread dot; mark unread.
- **Replies** go out from the account that owns the conversation, and only its owner or an
  admin may send. They count toward the account's daily activity. "Suggest a reply" drafts
  one with Claude Haiku from the thread, product facts and writing style.
- **Tags** (Settings > Tags) with colours; toggle them on a conversation.
- Home shows replies waiting for an answer.

Phase 6, drafting and Message Review:

- **Drafting after acceptance** (plan section 4): when a lead accepts, the worker drafts
  every AI message in that lead's sequence with one Claude Sonnet 5.5 call
  (`src/lib/drafting.ts`). The same call scores the lead's fit with the product (1 to 5,
  with a reason) and records the angle. If drafting is missed or fails, the engine asks
  again when the lead's first AI step comes due.
- **Any sequence:** each message gets a role (opener, follow-ups, last note). Product facts
  are offered and checked by role: the opener has no link, price or free offer; follow-ups
  may give the price and proof but no links; the last note may use the free offer and the
  booking link but not the price. Template and already-sent messages are shown to Claude
  as context so they are not repeated. The campaign's playbook brief is part of the prompt.
- **Message Review** (`/message-review`): To review, Approved and Sent queues; filter by
  campaign or name; approve leads in bulk. Each lead opens a panel with every message (edit
  with live rule checks, approve, regenerate with an instruction, exclude the lead, teach
  the writing style from feedback) and the lead's details, fit score and angle. Sent
  messages are locked and never appear in the review queue.
- **Approval per campaign:** "Review every lead" (default) or "Send automatically", where
  drafts that pass every rule are approved on their own and the rest still wait for review.
- Approving a lead the engine is holding releases it at once.

Phase 5, sending engine (`src/lib/engine/engine.ts`, run by the worker):

- Every minute, each connected and switched-on account takes **at most one** LinkedIn
  action, then waits a random 4 to 11 minutes. Follow-up messages go before new invites.
- Only inside each campaign's days and hours (in its timezone), and under every limit:
  the campaign's daily limits per account, the account's warm-up limits (rolling 24 hours),
  75 invites per rolling week, and 120 actions a day in total.
- **Warm-up:** new accounts start at 5 invites and 20 messages a day; every 2 days of clean
  sending adds 1 invite and 3 messages, up to 15 and 40.
- Each lead is **pinned** to the account that sends its invite. A profile lookup before
  the invite skips people who are already connected or already invited.
- **Acceptances** arrive by the `new_relation` webhook, with a check of each account's
  recent connections every 2 hours as a backup. Invites not accepted in 21 days are closed.
- **Replies** arrive by the `message_received` webhook. Before every message the engine
  also reads the chat and stops if the lead has replied. A reply cancels the remaining
  steps and discards unsent drafts.
- **Errors:** a problem with one lead (profile gone, cannot be reached) fails that lead
  only. A problem with the account (signed out, checkpoint, rate limit, LinkedIn limit)
  pauses the account with the reason shown on Accounts and Home, and never retries in a
  loop; the lead stays with that account. Network errors back off 15 minutes; three in a
  row pause the account. Switching the account back on clears the pause.
- AI-drafted steps wait for an approved draft (Phase 6). Template steps send as written.
- Only one engine pass runs at a time, even with several workers (database lock).

Phase 4, Campaigns:

- **Builder:** name, lead list, product, writing style, playbook (Curiosity, Plain ask,
  Specific to them, Custom), the step list, sending accounts, active days and hours with a
  timezone, and daily limits per account (capped at 15 connection requests and 40 messages)
- **Steps:** a connection request (no note, or a template note for Sales Navigator accounts,
  up to 300 characters), then 1 to 5 messages, each AI-drafted or a fixed template with
  {first_name}, {last_name}, {company}, {title} and a fallback for missing values
- **Readiness checks** before launch; **launch** enrolls the list's leads. Anyone already in
  another campaign, or without a LinkedIn profile, is enrolled as skipped, under a database
  lock so two launches cannot both claim a person.
- After launch the lead list and sequence are fixed (duplicate to change them); name,
  accounts, schedule and limits stay editable. Pause, resume, duplicate, delete, and exclude
  individual leads.
- **Nothing is sent yet.** The sending engine is Phase 5.

Phase 3, Voice:

- **Products:** name, description, ideal customer profile (with "Draft with AI"), services,
  specifics, competitors, value propositions, pain points, proof points, price, free offer,
  booking link and product pitch rules
- **Writing styles:** DO and DON'T rules, five starter packs (our own wording), a default
  product, and an activity log of every rule change
- **Playground:** drafts opener, follow-up 1 and last note for an imported lead or a made-up
  prospect. Feedback on any message is turned into proposed rules that you accept one by one.
  **Play the prospect:** let messages go unanswered one by one, or reply (quick replies or
  your own words) and see what the system would do: remaining messages cancelled, the Inbox
  label and reason, and the suggested reply, using the same code as the real Inbox.
- **Step rules enforced in code** (`src/lib/voice/compose.ts`): each product field is only
  offered for the steps that may use it, and every draft is checked for links and prices in
  the opener, links in follow-up 1, prices in the last note, and the free offer appearing
  early. A failing draft gets one automatic rewrite; anything still wrong is shown as a warning.
- Models: Claude Sonnet 5.5 for drafting (with server-side refusal fallback), Claude Haiku 5.5
  for rules and profiles. Every call's token usage is stored in `ai_usage`.

Phase 2, Lead Sources:

- **Sales Navigator import:** paste a people-search URL, pick an account with Sales Navigator
  and a number of pages (25 leads each, up to 100 pages / 2,500 leads, LinkedIn's limit)
- **CSV upload:** up to 10,000 rows / 5 MB; columns matched by name; duplicates and rows
  without a LinkedIn URL or name plus company are skipped and counted
- **LinkedIn search:** keywords, job title, seniority (applied as title keywords), locations
  and industries (typed names matched to LinkedIn's ids), up to 40 pages / 1,000 leads
- Imports run in the background worker (pg-boss), one page at a time, 25 to 75 seconds
  apart, at most 40 search pages per account per day; over the limit the import waits until
  the next day. Imports can be stopped and resumed.
- Lists are shared with the whole team; only the creator or an admin can stop or delete
  one. Members can only run searches with their own LinkedIn accounts.

Phase 1:

- Next.js 16 + TypeScript, PostgreSQL via Drizzle, migrations in `drizzle/`
- Team logins (email and password, bcrypt, signed session cookie, login throttling,
  sessions revoked on password reset or deactivation)
- Roles: **admin** manages everyone's accounts and the Team page; **member** manages
  only the LinkedIn accounts they connected
- **Accounts** page: connect through Unipile hosted login (no LinkedIn passwords stored),
  status, on/off switch, Sales Navigator flag, reconnect, remove
- Unipile callbacks: hosted-login notify (HMAC-signed) and account-status webhook (shared
  secret). A status other than Connected switches sending off for that account.
- Docker, Docker Compose and Caddy files for the Hetzner deploy

Not built yet: the Phase 10 pilot, which needs real Unipile and Anthropic keys.

## Local development

Needs Node 22 and PostgreSQL 16.

```bash
cp .env.example .env   # fill AUTH_SECRET and UNIPILE_WEBHOOK_SECRET; set UNIPILE_MOCK=1
npm install
npm run db:migrate
USER_PASSWORD='choose-a-long-password' npm run user:create -- you@example.com "Your Name" admin
npm run dev      # web app
npm run worker   # background jobs, in a second terminal
```

With `UNIPILE_MOCK=1`, "Connect account" opens a simulated sign-in page instead of
Unipile, and searches return generated test leads, so everything works without a Unipile key.
With `AI_MOCK=1`, drafts are canned text instead of Claude calls.

In mock mode the engine fakes LinkedIn: invites are accepted for about 70% of leads, about
a quarter reply after the first message (with interested, maybe, not interested, pitching
and needs-human style replies), the worker ticks every 3 seconds, and a "day"
lasts 10 seconds (`MOCK_DAY_SECONDS` changes it) so a whole sequence plays out in minutes.
Leads named `FailAccount` or `FailLead` make the mock fail like LinkedIn does, for testing.

Do not run `next build` while `next dev` is running: they share `.next`, and the dev server
then reloads the page in a loop. Stop the dev server, build, then delete `.next` before
starting it again.

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and `npm run db:migrate`.

## Load test

```bash
createdb outreach_load
DATABASE_URL=postgres://outreach:outreach@localhost:5432/outreach_load npm run db:migrate
DATABASE_URL=postgres://outreach:outreach@localhost:5432/outreach_load npm run load-test
```

It refuses to run on a database whose name does not contain "load", because it deletes
everything. Last run (4 minutes, mock day of 120 seconds): 1,782 invites and 1,729 messages
from 100 accounts; an engine pass took 131 ms median and 1 s at most; the lock skipped 649
overlapping passes from the second loop; all ten safety checks passed (limits, one account
per lead, accounts belong to the campaign, nobody invited twice, all 200 cross-format
duplicates caught, nobody contacted after joining the do-not-contact list, no message after
a reply, no leads left locked).

## Going live

**Step-by-step pilot guide: [docs/PILOT.md](docs/PILOT.md)**. On a fresh Ubuntu server,
`sudo bash scripts/setup-server.sh` does the whole server setup in one go (accounts to open, server setup,
the first 20-lead campaign, what to watch, and how to decide on rollout). (Phase 1 parts of plan section 7)

1. Fill `.env` on the app server: `DATABASE_URL` (database server's private IP), `APP_URL`
   (`https://app.yourdomain.com`), `AUTH_SECRET`, `UNIPILE_DSN`, `UNIPILE_API_KEY`,
   `UNIPILE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `DOMAIN` (`app.yourdomain.com`). Leave
   `UNIPILE_MOCK` and `AI_MOCK` empty. Set a monthly spend limit on the Anthropic key in the
   Anthropic Console.
2. `docker compose up -d --build` (starts the app, the worker and Caddy)
3. `docker compose run --rm app npx tsx scripts/migrate.ts`
4. `docker compose run --rm -e USER_PASSWORD='...' app npx tsx scripts/create-user.ts you@example.com "Your Name" admin`
5. Register the webhooks (account status, messages, new connections) once:
   `docker compose run --rm app npx tsx --conditions=react-server scripts/register-webhooks.ts`
6. Open `https://app.yourdomain.com`, sign in, connect one lower-risk account.

**Unipile API check (done 2026-11-09):** every request, response field, webhook payload
and error type the app uses was compared with developer.unipile.com and corrected where it
differed. Notable points from Unipile's docs that the engine follows:
- `cannot_resend_yet` means LinkedIn's weekly invitation limit: invites from that account
  pause for 3 days (messages continue), and also when LinkedIn reports 95% usage.
- Many rejected requests can get an account disconnected: 5 in a row pause the account.
- New-connection checks run a few times a day at random intervals (the webhook is the main
  signal and can lag up to 8 hours).
- Unipile's guidance for LinkedIn: about 100 profile views and 100 messages a day per
  account; paid accounts 80 to 100 invites a day and about 200 a week, free accounts about
  150 a week without a note and only a few notes a month. Accounts with under ~150
  connections may have invites held for verification by LinkedIn. The app's defaults (15
  invites a day, 75 a week) stay well under these.