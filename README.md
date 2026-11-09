# Outreach (working name)

Self-hosted multi-account LinkedIn outreach tool. The plan is in
[docs/ACTION_PLAN.md](docs/ACTION_PLAN.md); the feature reference is
[docs/sendroq-scrape.md](docs/sendroq-scrape.md) (used to understand the features only; all
wording and design here are our own).

## Status: Phases 1 to 7 done

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

Not built yet: Phase 8 (Home and campaign analytics) onward.

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

## Going live (Phase 1 parts of plan section 7)

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

**Check before the first real connection:** the Unipile request and payload shapes in
`src/lib/unipile.ts` (hosted login, account status, people search, search parameters,
profile lookup, invites, chats and messages, chat list, relations), the webhook payloads
(including how `is_sender` / `account_info.user_id` tell our messages from theirs) in
`src/app/api/unipile/webhook/route.ts`, the error types in `classifyError`
(`src/lib/engine/engine.ts`), the
search result field names in `src/lib/linkedin.ts`, and the status names in
`src/lib/accounts.ts` were written from
Unipile's documentation as I know it, because developer.unipile.com was not reachable from
the build environment. Compare them with the current docs (hosted auth, account status
webhook) and test with one account.
