# Outreach (working name)

Self-hosted multi-account LinkedIn outreach tool. The plan is in
[docs/ACTION_PLAN.md](docs/ACTION_PLAN.md); the feature reference is
[docs/sendroq-scrape.md](docs/sendroq-scrape.md) (used to understand the features only; all
wording and design here are our own).

## Status: Phase 1

Done:

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

Not built yet: everything from Phase 2 (Lead Sources) on. Accounts start at 5 invites and
20 messages a day; the Phase 5 sending engine will raise these during warm-up.

## Local development

Needs Node 22 and PostgreSQL 16.

```bash
cp .env.example .env   # fill AUTH_SECRET and UNIPILE_WEBHOOK_SECRET; set UNIPILE_MOCK=1
npm install
npm run db:migrate
USER_PASSWORD='choose-a-long-password' npm run user:create -- you@example.com "Your Name" admin
npm run dev
```

With `UNIPILE_MOCK=1`, "Connect account" opens a simulated sign-in page instead of
Unipile, so the whole flow works without a Unipile key.

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and `npm run db:migrate`.

## Going live (Phase 1 parts of plan section 7)

1. Fill `.env` on the app server: `DATABASE_URL` (database server's private IP), `APP_URL`
   (`https://app.yourdomain.com`), `AUTH_SECRET`, `UNIPILE_DSN`, `UNIPILE_API_KEY`,
   `UNIPILE_WEBHOOK_SECRET`, `DOMAIN` (`app.yourdomain.com`). Leave `UNIPILE_MOCK` empty.
2. `docker compose up -d --build`
3. `docker compose run --rm app npx tsx scripts/migrate.ts`
4. `docker compose run --rm -e USER_PASSWORD='...' app npx tsx scripts/create-user.ts you@example.com "Your Name" admin`
5. Register the account-status webhook once:
   `docker compose run --rm app npx tsx --conditions=react-server scripts/register-webhooks.ts`
6. Open `https://app.yourdomain.com`, sign in, connect one lower-risk account.

**Check before the first real connection:** the Unipile request and payload shapes in
`src/lib/unipile.ts` and the status names in `src/lib/accounts.ts` were written from
Unipile's documentation as I know it, because developer.unipile.com was not reachable from
the build environment. Compare them with the current docs (hosted auth, account status
webhook) and test with one account.
