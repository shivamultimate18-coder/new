# SendRoq walkthrough: build reference

Captured 2026-11-09 from a logged-in walkthrough of app.sendroq.com.
Goal: build a personal tool that connects multiple LinkedIn accounts and runs controlled automation.

This is page-by-page notes with the on-screen copy that was captured, not a raw HTML dump. Names, emails and profile links of prospects and of connected LinkedIn accounts are deliberately left out. Items marked (inference) were deduced, not shown in the UI.

Not captured: Composer page; Import CSV form; Add step options; message-step AI settings; Inbox reply box and intent-change control; final Infinite Login form; a Playground session.

## Requirements stated by the owner

- Connect multiple LinkedIn accounts; run controlled automation.
- Sales Navigator import is the priority lead source: enter a Sales Nav URL, tool scrapes the leads through Sales Nav, and shows which accounts have Sales Nav access.
- Hyperpersonalization: build a profile per lead, generate opening message, pitch and 2-4 follow-ups, wait for approval before sending.
- Writing style and product data feed the personalization.
- Unibox: combine all account inboxes into one normal inbox; sort leads into Interested, Maybe, Not interested from their replies.
- Account connection: provide email, password and 2FA key; tool logs in automatically.

## Navigation

| Section | Page | URL |
|---|---|---|
| | Home | / |
| Discover | Lead Sources | /agents (new: /new-agent) |
| Execute | Campaigns | /campaigns (new: /campaigns/new, edit: /campaigns/new?campaignId=ID, detail: /campaigns/ID) |
| Execute | Composer | /composer |
| Execute | Message Review | /message-review |
| Execute | Voice | /voice |
| Converse | Inbox | /unibox |
| Settings | Accounts | /accounts |
| Settings | General | /general |

## Home (/)

- Greeting, "Here's what happened while you were away.", date-range picker, "+ New campaign".
- KPI cards: Invites Sent, Leads Approved, Messages Sent, Replies Received.
- Daily line chart of those 4 metrics with hover tooltip.
- "Action needed": Messages waiting for approval; Replies to respond to.
- Sample week: about 300 invites/day, 2,074 invites, 566 messages, 57 replies.

## Lead Sources (/agents)

- Subtitle: "CSV, Sales Navigator, and Basic Search imports that create leads for your campaigns."
- Search, "New Source".
- Table: Source (name, "Lead List"), Results (lead count), Status ("Ready"), Detail ("Ready for campaign", "Updated N days ago"), Action (Open, Delete). Paginated.
- Lists top out around 2,500 leads (inference: per-import cap matching Sales Nav's search limit).

### New Source (/new-agent): "Where do you want to get leads?"

- Import CSV: "Upload a CSV file with your leads." Tag: Supports .csv
- LinkedIn Sales Navigator: "Import leads from a Sales Navigator people search URL." Tag: Requires Sales Nav
- Basic Search: "Search LinkedIn by role, seniority, location, and industry." Tag: Live LinkedIn search
- "Skip for now"

### Sales Navigator import (steps: Source > Import > Start > Done)

- Lead list name (placeholder "Sales Nav founders")
- Sales Navigator account dropdown
- Warning when none: "No connected account has Sales Navigator enabled."
- Sales Navigator search URL (placeholder "Paste the people search address bar URL, or the salesApiLeadSearch request URL from DevTools")
- Pages to import (default 2)
- Back; "Start Sales Navigator import"
- (inference) Uses the account's session against LinkedIn's internal salesApiLeadSearch endpoint and pages through results.

### Basic Search (steps: Source > Configure > Done)

- "Search our people database by keyword, seniority, location, and industry. Results are added to your lead list."
- Agent name, LinkedIn account, Keywords, Seniority (C-suite, Founder, Owner, Partner, VP, Head), Locations, Industries, Pages to import, Back, "Start Basic Search".

## Campaigns (/campaigns)

- Search, Status filter, Date filter, New campaign.
- Overview: Running campaigns (N paused), Messages sent (14 days), Replies received (14 days), Approvals needed (links to Message Review).
- Performance chart: messages sent vs replies; Total sent, Total replies, Reply rate.
- Cards: name, created date, status, channel (LinkedIn), workflow, lead list, Total prospects, Reachouts, Acceptance rate, Response rate, "Working leads N in progress", Resume, overflow menu. Paginated.

### Campaign detail (/campaigns/ID)

- Header: name, status, "workflow · lead list", % complete, Resume, Delete, Edit.
- Stats: Pending (not started), Scheduled (queued), Completed (of total leads), Reply rate.
- Readiness ("Launch dependencies and current state."): Lead list, Workflow, Sender accounts (N assigned), Active window (N days).
- Tabs:
  - Leads: "Lead execution queue. Contacts moving through this campaign sequence." Status filter; columns Contact, Current step, Status (Running, Completed), Scheduled, Error, Actions (Exclude).
  - Planned messages: when off: "This campaign is not hyperpersonalized. It sends the messages written in the workflow. Nothing is queued here for review."
  - Workflow: "Active-count badges show where leads currently sit." Start > Send Connection Request > Wait 1 day > Send Message > Wait > Send Message > ...
  - Config: Schedule policy ("The orchestrator uses this window for dispatch."): Active days, Active hours (09:00 to 17:00), Timezone (America/New_York), Created. Assignments: Lead list, Workflow, LinkedIn accounts.

### Create Campaign (/campaigns/new)

Header: Close, "Campaigns / Create Campaign", Launch Campaign. Tab "First Outreach".

Canvas (left), default sequence:
Sequence starts > Send Connection Request (Day 1) > Wait 1 day > Send Message (Day 2, AI generated) > Wait 2 days > Send Message (Day 4, AI generated) > Wait 3 days > Send Message (Last, Day 7, AI generated) > Add step. Wait steps have +/-. Zoom in, zoom out, fit view, minimap.

Connection step panel: Note (optional), variables First name, Last name, Company, Headline; Missing-variable fallback ("Fallback if variables are missing..."); Save step.

Settings (right), Save button:
- Campaign name (e.g. Founder outreach)
- Writing style: "How the notes sound."
- Product: "What you sell. The writer pulls a compact slice of this product."
- Outreach strategy: "Playbooks rebuild the sequence on the canvas. Custom starts blank so you can add your own steps."
  - Open loop: "Notice something unfinished, then help."
  - Straight shot: "Honest, casual, tiny asks."
  - Genuine callout: "Specific about them, then help."
  - Custom: "Build the sequence yourself on the canvas."
  - Each has "See example".
- Reach out via: "Blank connection request, then three messages after they accept. Pick a Sales Navigator account to put the first note on the invite."
- Sending accounts: "Messages go out from the accounts you pick here." Empty state: "No active completed accounts found."
- Leads: "A ready list is selected by default. Click it to switch. New lists live in Lead Sources." Change.
- Sequence timing: "Campaigns only send inside this window." From, To, Timezone, day chips Mon-Sun.
- Daily limits: "Each account in this campaign stops at these numbers for the day." Messages/day max 40; Invites/day max 25.

Open loop example explanation:
1. Connect earns attention from a real observation, not their product blurb.
2. Follow-up 1 explains the observation, then mechanism, named proof, a real question.
3. Last bump is a useful consequence on the same insight, not a clone.
"Flavor is curiosity: leave an unresolved observation, then make it make sense in follow-up 1. Do not manufacture a tease."

## Message Review (/message-review)

- "N messages pending review", search by name or company.
- Queues: Approvals, Scheduled.
- Table with bulk checkboxes: Prospect name, Company with role, Review (e.g. Sent), ICP fit, Industry, Location, Social, School, Drafted.
- Row opens drawer: close, up/down to move between leads, campaign name, Approve.
- Left: message cards (Message, Follow-up 1, ...) with Edit, Regenerate, Feedback, Remove.
- Right: lead panel with name, headline, ICP fit, Campaign, Review, LinkedIn, Location, Industry, expandable Experience, Education, Profile.

Observed output shape (examples anonymized):
- Opener: role or headline hook, one specific problem, one soft question. About 35 words, no link.
  "[Name], eight-figure growth in paving often means local demand is already strong, but customers asking ChatGPT which contractor to hire may not see the best-established option. Worth comparing what it recommends in your area?"
- Follow-up 1: why it happens, one proof point, one closing question.
  "The issue is whether AI can identify your turnaround work when prospects ask for help locally. ChatGPT, Gemini, and Perplexity use different sources, so visibility can vary by platform. In one audit, the same business appeared in 5 of 5 Gemini answers but 0 of 5 ChatGPT answers. Have you checked both?"

Gaps to improve: ICP fit and Industry were blank; "pending review" list included Sent items; Sent items still showed Approve and Regenerate.

## Voice (/voice)

"Train what you sell and how outreach writes. Playground feedback becomes the rules."

### Products & services (list, search, + creates a record immediately)

| Field | On-screen guidance |
|---|---|
| Name | Key facts so outreach stays accurate. |
| Brief description (required) | Describe the offer in a few sentences. "What you sell, who it's for, and why they buy." |
| Ideal customer profile | Who actually buys this. Demographics, titles, signals. Undo, Regenerate ICP |
| Booking link (optional) | Never dropped into a first-touch note. Keep it here for later steps. |
| Product specifics | Facts the writer can pick from, not dump. |
| Competitors | |
| Services | If you sell more than one thing, list them. The writer picks one per person. |
| Price (optional) | Plain words. Used in the first follow-up only. |
| Free offer (optional) | A small thing you will actually do. If this is empty, the last note just leaves politely. |
| Value propositions (required) | The specific value this product or service provides. |
| Pain points (required) | Problems this offer solves. |
| Proof points (required) | Quotes, numbers, or short case notes. Include a source when you have one. |
| Product pitch rules | Offer-specific DO's and DON'Ts. Writing style still owns how it sounds. |

Pitch rules seen:
- Personalize around their company, posts, growth, hiring, or outbound.
- Introduce features only after identifying relevance.
- Don't: make unsupported guarantees about meetings, leads, or revenue.
- Don't: send a long pitch before interest.
- Don't: add em dashes in responses.
- Don't: create big responses; keep it max 4 lines with a proper CTA.
- Don't: lead with "AI automation" as the entire pitch.

### Writing styles

Tabs: Rules, Playground, Activity. Header: "Writing as [style] · selling [product]".

Rules: "Pick a starter pack to copy DO's and DON'Ts onto this style, then edit them." Packs: Super Casual, Warm & Human, Sharp & Direct, Insight-Led, Proof & Credibility. Product selector. Editable DO and DON'T lists.

DO rules seen:
- keep it to ~30-40 words, respect their time
- use short, confident sentences, say the reason you are reaching out plainly
- open with the single sharpest specific observation about them, no warm-up
- sound like a real person, not a template
- use first name only and normalize the company name (no "Inc.", no last names)
- write in an active voice
- keep personalization to 1-2 load-bearing facts that actually connect to why you are reaching out
- open on a constraint they feel, not a paraphrase of their product or headline

DON'T rules seen (list was only partly captured, 12 in total):
- add pleasantries or preamble before the point
- hedge or qualify ("I was wondering", "just", "maybe", ...)
- fabricate a result, customer, or case
- be generic; the message must only (rest not captured)

Playground: "Generate a no-reply sequence with this writing style and [product]. Sit as the prospect: skip to see the next grab, reply interested to book, or pass to leave." Choose pack, "Start a session".

Activity: "What this style has learned recently": log rows of type, description, date (e.g. PACK APPLIED).

## Inbox (/unibox)

- "All accounts · N conversations", Sync more.
- Avatar tabs: All accounts plus one per LinkedIn account.
- Look up tip: "Look up on an Unknown prospect loads their name, photo, headline, and company from LinkedIn."
- Search; campaign dropdown; Unread toggle; All, Interested, Maybe, Not interested.
- Row: prospect, intent badge, company, age, last message preview, headline, "+" (tags, inference), tag chips such as "booked".
- Drawer: photo, name, LinkedIn link, headline, "Account · [sender]" chip, thread with "[account] sent" and "[prospect] replied" timestamps.

Weak spots: Interested label stayed on threads whose last message was ours; a prospect pitching their own services back was labelled Interested. Consider re-scoring on inbound only and a "Pitching us / Needs human" label.

## Accounts (/accounts)

"Connect and manage your LinkedIn accounts used for outreach."

Card: photo, name, email, LinkedIn badge (one account gold, others purple; gold may mean Sales Nav, inference), status (e.g. Disabled), on/off switch, overflow menu, Connected N days ago, Last activity, Actions today, Active campaigns, Conversations, Settings, Delete. Bottom card prompts "Connect account".

Settings popup: Preferences, "Only use with SendRoq: Pause this account's automation if it's used outside SendRoq." Cancel, Save settings.

### Connect LinkedIn account: "Choose a connection method"

- Chrome Extension: "Connect without entering LinkedIn credentials into SendRoq." Uses "the LinkedIn session already open in this browser."
- Infinite Login (Recommended): "LinkedIn credentials with 2FA secret for longer-lived sessions."
- Credentials Login: "Classic email and password flow with proxy location." Fields: LinkedIn email address, LinkedIn password, Country, Connect account.

Infinite Login flow:
1. "Activate Infinite Login in 2 minutes. Infinite login protects your LinkedIn account from getting disconnected and pausing your campaigns. To use it, you'll need to enable LinkedIn Two-Factor Authentication (2FA). If your LinkedIn account is already connected, you'll need to disconnect and reconnect it to activate Infinite Login." Buttons: No, I don't have 2FA; Yes, I have 2FA.
2. "Did you use an Authenticator app to enable 2FA? Infinite login requires app-based codes, not SMS." Checkbox. "Do you have your 2FA secret key? The 2FA secret key is shown once when you enable 2FA. It is not the 6-digit code." Checkbox. Next.
3. Form not captured; per owner: email, password, 2FA key.

## General (/general)

"Security, tags, and billing."
- Security: Change password (current, new, Update password).
- Tags: "Create and manage tags to organise your inbox conversations." New tag name, 10 colour swatches, Add; rows with Edit, Delete.
- Billing: Current plan, slots, Access, Connected accounts N / limit.

## Suggested implementation

Build order: Accounts > Lead Sources (Sales Nav first, then CSV) > Voice > Campaigns > Message Review > Inbox > Home.

Core tables: accounts (status, has_sales_nav, proxy_id, session_expires_at, daily counters, paused_reason), lead_lists, leads, products, writing_styles, campaigns, sequence_steps, lead_state (current step, next_run_at, assigned account, error), message_drafts (lead, step, body, status, version), conversations, messages, tags.

- Login worker: Playwright, email + password, TOTP from the secret, save li_at and JSESSIONID, re-login on expiry.
- One residential proxy, user agent and browser profile per account.
- On CAPTCHA or security check: pause the account and alert; never retry in a loop.
- Encrypt passwords and 2FA secrets at rest with the key outside the database; never log them.
- Scheduler: pick due leads, check active window and per-account daily limit, queue with random delays.
- Pin each lead to one sending account from invite to last message.
- Any inbound reply cancels that lead's remaining follow-ups.
- Message generation layers: lead data + product facts + writing style rules + step rules. Enforce per-step field access in code (opener: no link or price; follow-up 1: price and proof; last note: free offer).
- Draft status: drafted > approved > scheduled > sent; lock sent items.
- Intent: classify the whole thread on each inbound reply; manual labels override and are never overwritten.
- LinkedIn's terms prohibit automation and accounts can be restricted; keep limits conservative.
