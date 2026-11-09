# Self-hosted LinkedIn outreach tool: action plan

Updated 2026-11-09. Goal: run our own multi-account LinkedIn outreach tool for our team's 100 accounts, instead of paying for Sendroq.

Build times and API usage are estimates. Vendor prices came from web searches on this date, so re-check them before paying.

## 1. Reference material

- **[sendroq-scrape.md](sendroq-scrape.md)** is the page-by-page walkthrough of the logged-in app, and is the feature reference for this build.
- **Not captured:** Composer page, CSV import form, Add step options, AI settings on message steps, inbox reply box, final Infinite Login form, a Playground session. We design these ourselves, or capture them later if needed.
- **Backend code and AI prompts** are not in the scrape and are built new.

## 2. What we are building

| Area | Features | Notes |
|---|---|---|
| Accounts | Connect accounts, status, on/off, daily activity, Sales Navigator flag | See section 5 for login |
| Lead Sources | Sales Navigator URL import (priority), CSV, basic search | LinkedIn caps each search at 2,500 results |
| Voice | Products with facts, proof and pricing; writing styles with DO and DON'T rules; test playground | Feeds every message |
| Campaigns | Step sequence, playbooks, sending accounts, active hours and days, daily limits | Start with a simple step list, add a visual canvas later if wanted |
| Message Review | Approval queue, edit, regenerate, lead details panel | Locks after sending |
| Inbox | All accounts in one inbox, Interested / Maybe / Not interested, tags | Reply from the account that sent |
| Home | Invites, approvals, messages, replies, items needing action | |

**Where we can beat Sendroq,** based on problems seen in the walkthrough:

- Fill in lead fit and industry scores, which were blank there.
- Keep sent messages out of the pending list, and lock them against approve and regenerate.
- Re-score intent only when the prospect replies.
- Add "Pitching us" and "Needs human" labels, because a prospect pitching back was marked Interested.

**Own wording:** the scrape records Sendroq's on-screen copy, playbook names and sample rules. We use it to understand the features and write our own text, names and design.

## 3. Risks to accept before building

1. **LinkedIn account restrictions.** LinkedIn's User Agreement prohibits automated activity. With 100 accounts on one system, one LinkedIn enforcement change could hit many accounts at once. Use accounts the team can afford to have restricted, and roll out slowly.
2. **Team passwords.** Storing 100 passwords and 2FA secrets in one database means a single breach exposes every account. Section 5 avoids this.
3. **`sendroq agreement.docx` in Downloads** has not been opened. Check it for non-compete, confidentiality or IP clauses before building. Sendroq's terms also forbid scraping without permission.
4. **Personal data.** The system stores data about about 32,500 new prospects a month. Keep only what is needed, delete on request, and check GDPR duties if contacting people in the EU or UK.

## 4. Monthly running cost at 100 accounts

| Item | Draft after acceptance (recommended) | Draft every lead up front |
|---|---:|---:|
| Unipile (100 x $5.00, excluding VAT) | $500 | $500 |
| Claude API | $340 | $990 |
| App server, database server, backups | $60 | $60 |
| Error tracking and monitoring | $30 | $30 |
| Domain | $1 | $1 |
| **Subtotal** | **$931** | **$1,581** |
| Sales Navigator, 5 seats for lead sourcing | $600 | $600 |
| **Total** | **$1,531** | **$2,181** |

- **Compared with Sendroq:** ten of the $500 Agency plans listed on Capterra would be $5,000 a month, before Sales Navigator. That suggests a saving of about $4,000 a month. This is an extrapolation from an unverified listing, so use your actual quote.
- **Sales Navigator** is about $120 per seat per month billed monthly, or about $90 billed annually. Remove this line for seats you already pay for. Only accounts with a seat can run the import or put a note on the invite.
- **Batch API** roughly halves the drafting cost. It suits work that can wait a few hours, and can bring the recommended Claude line down to about $180.

**How the Claude estimate works,** at 75 invites per account per week, which is about 325 leads a month and 32,500 across 100 accounts:

| Step | Model | Cost |
|---|---|---:|
| Score 5 candidates to pick 1 lead | Haiku 5.5 | $0.002 per invited lead |
| Research plus opener and follow-ups, in one call | Sonnet 5.5 | $0.027 per sequence |
| Reply classification and reply drafts | Haiku 5.5 | $0.0015 per lead |

The recommended column assumes a blank invite and about 30% acceptance, so only accepted leads get a full sequence. Acceptance is an assumption, and should be replaced with real numbers from the pilot. It also cuts the review workload.

## 5. Recommended system

| Part | Choice | Reason |
|---|---|---|
| App and dashboard | Next.js with TypeScript | One codebase for interface and API |
| Database | PostgreSQL on its own server | Handles the data and the job queue |
| Job queue | pg-boss | Uses Postgres, so no Redis to run |
| LinkedIn connection | Unipile | Login, Sales Navigator URL search, messages and reply webhooks |
| AI | Claude API | Haiku 5.5 for volume, Sonnet 5.5 for drafting |
| Hosting | Hetzner, Docker Compose, Caddy for HTTPS | Cheap and simple |

Core tables: `accounts`, `lead_lists`, `leads`, `products`, `writing_styles`, `campaigns`, `sequence_steps`, `lead_state`, `message_drafts`, `conversations`, `messages`, `tags`, `suppression_list`, `activity_log`.

**Account login options:**

| | Unipile hosted login (recommended) | Unipile with our stored credentials | Our own browser login |
|---|---|---|---|
| How it works | Each person signs in on Unipile's page | We submit email, password and 2FA code | Playwright, one proxy per account, as the scrape suggests |
| We store passwords | No | Yes, encrypted | Yes, encrypted |
| When a session expires | That person reconnects by link | Can reconnect automatically | Can reconnect automatically |
| Monthly cost for connection | $500 | $500 | $210-860 for proxies and extra servers |
| Extra build time | None | 2-3 days | 3-4 weeks, plus repairs when LinkedIn changes |

Our own browser login ranges from saving $290 a month to costing $360 more, while adding the most build work and the highest restriction risk, so it is not recommended.

**Account safety rules, built into the sending engine:**

- Start each account at 5 to 10 invites a day and rise slowly to a maximum of 15 a day and 75 a week. Keep total actions under 120 a day. Sendroq's screen allows 25 invites and 40 messages a day, but 25 invites a day would exceed the 60 to 100 a week that vendor guides report as safe.
- Send only inside each campaign's hours and days, at uneven intervals, with no sudden jumps in volume.
- Pin each lead to one sending account from invite to last message.
- Keep a shared already-contacted and do-not-contact list, so two accounts never message the same person.
- Cancel remaining follow-ups as soon as someone replies.
- Pause the account and alert on any LinkedIn warning, checkpoint or error. Never retry in a loop.

**Message rules enforced in code:** the opener has no link or price, follow-up 1 can use price and proof, and the last note can use the free offer.

**Approvals at this scale:** reviewing every sequence takes too long if every lead is drafted up front, at about 1,500 a working day or roughly 8 hours at 20 seconds each. Drafting after acceptance brings this to about 450 a day, roughly 2.5 hours, spread across the team. Review everything during the pilot, then let proven campaigns auto-approve with a sampled check.

## 6. Build plan

| Phase | Work | Days |
|---|---|---:|
| 0 | Confirm decisions, open Unipile, Anthropic and Hetzner accounts | 1 |
| 1 | App skeleton, team logins, database, Accounts page, first deploy | 3-4 |
| 2 | Lead Sources: Sales Navigator, CSV, basic search | 3-4 |
| 3 | Voice: products, writing styles, playground | 3-4 |
| 4 | Campaigns: sequence builder, playbooks, schedule, limits | 4-5 |
| 5 | Sending engine: scheduler, per-account limits, stop on reply, auto-pause | 4-5 |
| 6 | Message generation and Message Review | 3-4 |
| 7 | Inbox: all accounts, intent labels, tags, replies | 3-4 |
| 8 | Home and campaign analytics | 1-2 |
| 9 | 100-account hardening: duplicate prevention, health screen, load test, spend caps | 3-4 |
| 10 | Pilot on a small number of accounts | 2-3 |
| | **Total** | **30-40 working days** |

That is 6 to 8 weeks full time building with Claude Code. Then roll out in stages over 8 to 12 weeks: 1, 10, 25, 50, then 100 accounts, moving up only when the previous stage is stable. Expect about 5 to 10 hours a week of ongoing work on reconnects, restricted accounts and message quality.

**Build cost:** about $100-200 in cash (Unipile's 7-day free trial, then 1-2 months of the $55 tier, about $50 of API testing, servers, domain), plus your Claude plan.

## 7. Going live checklist

These steps will be finalized once the code exists.

**Accounts needed**
- [ ] Unipile API key and DSN
- [ ] Anthropic API key with a monthly spend limit set
- [ ] Hetzner account and a domain

**Servers**
- [ ] Create one app server and one database server on a private network, with SSH key login only and only 22, 80 and 443 open on the app server
- [ ] Install Docker and turn on backups
- [ ] Point a DNS A record at the app server, for example `app.yourdomain.com`
- [ ] Add `.env` with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `UNIPILE_DSN`, `UNIPILE_API_KEY`, `APP_URL`, `AUTH_SECRET`
- [ ] Run `docker compose up -d` and run the database migrations
- [ ] Confirm HTTPS works through Caddy

**Connections and reliability**
- [ ] Register the Unipile webhooks for new messages, accepted invites and account status
- [ ] Schedule a nightly database backup copied off the server, and test one restore
- [ ] Add an uptime monitor and error alerts

**Launch**
- [ ] Connect one lower-risk team account first
- [ ] Run a 20-lead campaign with manual approval on every message
- [ ] Confirm that sending, replies, stop-on-reply and auto-pause on errors all work
- [ ] Measure the real acceptance rate and update the cost estimate
- [ ] Roll out in the stages from section 6
- [ ] Cancel the Sendroq subscription only after the team has been stable on the new tool for two weeks

## 8. Decisions needed before building

1. Account login: Unipile hosted login, or stored credentials for automatic reconnects?
2. What do you currently pay Sendroq, and how many Sales Navigator seats does the team already have?
3. Does `sendroq agreement.docx` restrict building this?
4. A name for our own product.

## Sources

- [SendRoq on Capterra](https://www.capterra.com/p/10046014/SendRoq/)
- [Unipile pricing](https://www.unipile.com/pricing/), [LinkedIn search docs](https://developer.unipile.com/docs/linkedin-search), [Sales Navigator API article](https://www.unipile.com/sales-navigator-search-api-key-features-editors-need-to-know/), [auth and automation page](https://www.unipile.com/messaging-and-email-automation/)
- [Sales Navigator cost guide](https://www.joinvalley.co/blog/linkedin-sales-navigator-cost-explained-2026)
- [PhantomBuster safe limits](https://phantombuster.com/blog/linkedin-automation/linkedin-automation-safe-limits-2026/), [Konnector limits](https://konnector.ai/linkedin-automation-limits-2026/), [Salesforge limits](https://www.salesforge.ai/blog/linkedin-connection-request-limit)
- [Hetzner 2026 pricing summary](https://agentdeals.dev/hetzner-pricing-2026) (third party, check Hetzner directly)
- Claude model prices from Anthropic's current model table
