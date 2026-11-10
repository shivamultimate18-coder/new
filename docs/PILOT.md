# Pilot guide

Goal (plan section 7): run one lower-risk LinkedIn account through a 20-lead campaign with
every message reviewed, confirm sending, replies, stop-on-reply and auto-pause work, and
measure the real acceptance rate and AI cost. About 2 to 3 days of calendar time; roughly
1.5 hours of hands-on work.

Never paste API keys or passwords into chats, tickets or this repository. They go only in
the server's `.env` file.

## 1. Accounts to open (about 30 minutes)

| What | Where | What you need from it |
|---|---|---|
| Unipile | unipile.com, start the 7-day free trial | **DSN** (looks like `api8.unipile.com:13851`) and an **API key**, both in the dashboard |
| Anthropic | console.anthropic.com | An **API key**. Set a **monthly spend limit** on it first (for the pilot, $20 is plenty) |
| Hetzner | hetzner.com/cloud | One server: Ubuntu 24.04, CX22 (2 vCPU, 4 GB) is enough for the pilot |
| A domain | any registrar | A subdomain such as `app.yourdomain.com` |

## 2. Server setup (about 10 minutes)

1. Create the server (Ubuntu 24.04) with your SSH key, no password login. In the Hetzner
   firewall allow only ports 22, 80 and 443. Turn on backups.
2. Point a DNS **A record** for `app.yourdomain.com` at the server's IP address.
3. Log in to the server and run:
   ```bash
   git clone https://github.com/shivamultimate18-coder/new outreach && cd outreach && sudo bash scripts/setup-server.sh
   ```
   It installs Docker, asks for your domain, timezone, Unipile DSN and API key and
   Anthropic API key (typed on the server, never shown), generates every other secret into
   `.env` (readable by root only), checks the domain points at the server, starts the app,
   worker and database, creates the tables and your admin login (the password is printed
   once: save it), registers Unipile's webhooks, and checks HTTPS.
4. Open `https://app.yourdomain.com` and sign in.

The script is safe to run again, for example after fixing a DNS record or a key.

<details>
<summary>Doing it by hand instead</summary>

1. Install Docker: `curl -fsSL https://get.docker.com | sh`
2. `cp .env.example .env` and fill in `DOMAIN`, `APP_URL=https://<domain>`, `APP_TIMEZONE`,
   `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `DATABASE_URL=postgres://outreach:<that
   password>@db:5432/outreach`, `AUTH_SECRET` (`openssl rand -base64 48`),
   `UNIPILE_WEBHOOK_SECRET` (`openssl rand -hex 24`), `UNIPILE_DSN`, `UNIPILE_API_KEY`,
   `ANTHROPIC_API_KEY`; leave `UNIPILE_MOCK` and `AI_MOCK` empty.
3. `docker compose --profile with-db up -d --build`
4. `docker compose run --rm app npx tsx scripts/migrate.ts`
5. `docker compose run --rm app npx tsx scripts/create-user.ts you@example.com "Your Name" admin`
6. `docker compose run --rm app npx tsx --conditions=react-server scripts/register-webhooks.ts`
</details>

## 3. Set up the pilot in the app (about 30 minutes)

1. **Settings > AI usage:** set a monthly limit (e.g. $20).
2. **Accounts > Connect account:** sign in with one **established** LinkedIn account (ideally
   150+ connections; Unipile notes LinkedIn may hold invites from small or new accounts).
   Leave it switched **off** for now. It starts at 5 invites a day.
3. **Voice:** create the product (all fields marked *) and a writing style. In the
   Playground, draft for 3 to 5 imported or made-up prospects, give feedback, and keep
   going until the drafts read well. This uses real Claude now; check the cost on AI usage.
4. **Lead Sources:** import about 20 leads: a Sales Navigator search with **1 page** (25
   leads), or a CSV.
5. **Campaigns > New campaign:** that list, product and style, the default 3 messages,
   **Review every lead**, your working hours and days, and limits of 5 invites and 10
   messages a day. Launch.
6. **Accounts:** switch the account on.

## 4. What to watch (days 1 to 3)

- **Day 1:** invites go out a few at a time, a few minutes apart, only in working hours.
  Check one on LinkedIn itself (My Network > Manage > Sent). Account health should show no
  problems.
- **When someone accepts** (Unipile's notification can take up to 8 hours): drafts appear in
  **Message Review**. Read every one, edit if needed, approve. Check it arrives on LinkedIn.
- **Replies:** the lead's sequence stops at once and the reply shows in the **Inbox** with a
  label. Reply to one from the Inbox and check it arrives.
- **Safety:** to test auto-pause, in LinkedIn's settings sign out of all sessions once. The
  account should show "Needs reconnect" and stop sending; reconnect it from Accounts.

## 5. Decide

Write down, from Home and AI usage after about a week:

| Measure | Pilot result | Plan assumption |
|---|---|---|
| Acceptance rate | | 30% |
| Reply rate (of accepted) | | — |
| Claude cost per accepted lead | | about $0.03 |
| Drafts needing edits | | — |

Then update the cost estimate in `docs/ACTION_PLAN.md` section 4, and roll out in stages:
1, then 10, 25, 50 and 100 accounts, moving up only when the previous stage is stable.
Cancel Sendroq only after two stable weeks on the new tool.

## If something goes wrong

- `docker compose logs -f worker` shows the engine's decisions and any Unipile errors.
- An account paused by the engine shows the reason on **Accounts** and **Account health**.
  Fix the cause, then switch it back on.
- To stop all sending at once: `docker compose stop worker`. Nothing is sent while it is
  stopped; start it again with `docker compose start worker`.
