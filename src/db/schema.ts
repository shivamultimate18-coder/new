import {
  bigserial,
  boolean,
  primaryKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "member"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("member"),
  active: boolean("active").notNull().default(true),
  // Bumped on password change or deactivation to invalidate existing sessions.
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * pending          hosted login link created, person has not finished signing in
 * ok               connected and usable
 * needs_reconnect  LinkedIn session expired; the owner must sign in again
 * error            Unipile reports the account stopped or errored
 * disconnected     removed on the Unipile side
 */
export const accountStatus = pgEnum("account_status", [
  "pending",
  "ok",
  "needs_reconnect",
  "error",
  "disconnected",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unipileAccountId: text("unipile_account_id").unique(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull().default(""),
    publicIdentifier: text("public_identifier"),
    status: accountStatus("status").notNull().default("pending"),
    // The on/off switch. Sending requires enabled AND status = ok.
    enabled: boolean("enabled").notNull().default(false),
    hasSalesNav: boolean("has_sales_nav").notNull().default(false),
    pausedReason: text("paused_reason"),
    // Warm-up starts low (plan section 5). The sending engine raises it over time.
    dailyInviteLimit: integer("daily_invite_limit").notNull().default(5),
    dailyMessageLimit: integer("daily_message_limit").notNull().default(20),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_status_idx").on(t.status)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    detail: jsonb("detail"),
  },
  (t) => [index("activity_log_account_at_idx").on(t.accountId, t.at)],
);

export const leadSource = pgEnum("lead_source", ["sales_nav", "csv", "basic_search"]);

/**
 * queued     waiting for the worker
 * running    pages are being fetched
 * waiting    paused until the account has search budget again (next day)
 * ready      finished; usable in campaigns
 * failed     stopped with an error (see `error`)
 * cancelled  stopped by a person; leads imported so far are kept
 */
export const leadListStatus = pgEnum("lead_list_status", [
  "queued",
  "running",
  "waiting",
  "ready",
  "failed",
  "cancelled",
]);

export const leadLists = pgTable(
  "lead_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    source: leadSource("source").notNull(),
    status: leadListStatus("status").notNull().default("queued"),
    // The LinkedIn account whose session runs the search. Null for CSV.
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // Search URL or filters; for CSV the file name and row counts.
    params: jsonb("params").notNull().default({}),
    pagesRequested: integer("pages_requested").notNull().default(0),
    pagesDone: integer("pages_done").notNull().default(0),
    cursor: text("cursor"),
    // Token of the one page job allowed to run next. Stale or duplicate jobs are ignored.
    jobToken: text("job_token"),
    // Total results LinkedIn reports for the search (may exceed what can be imported).
    reportedTotal: integer("reported_total"),
    leadCount: integer("lead_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_lists_created_idx").on(t.createdAt)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => leadLists.id, { onDelete: "cascade" }),
    // Stable key for de-duplication within a list: LinkedIn member id, else profile slug,
    // else name + company.
    // Insertion order, so leads list in the order they were found or appeared in the file.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    linkedinId: text("linkedin_id"),
    publicIdentifier: text("public_identifier"),
    profileUrl: text("profile_url"),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    headline: text("headline"),
    title: text("title"),
    company: text("company"),
    location: text("location"),
    industry: text("industry"),
    email: text("email"),
    // Everything else from the source row, for later personalization.
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_list_dedupe_idx").on(t.listId, t.dedupeKey),
    index("leads_linkedin_id_idx").on(t.linkedinId),
    index("leads_list_seq_idx").on(t.listId, t.seq),
  ],
);

// ---------------------------------------------------------------------------
// Voice (Phase 3): what we sell and how outreach should sound.

export type RuleSet = { do: string[]; dont: string[] };

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icp: text("icp").notNull().default(""),
  bookingLink: text("booking_link").notNull().default(""),
  specifics: text("specifics").notNull().default(""),
  competitors: text("competitors").notNull().default(""),
  services: text("services").notNull().default(""),
  price: text("price").notNull().default(""),
  freeOffer: text("free_offer").notNull().default(""),
  valueProps: text("value_props").notNull().default(""),
  painPoints: text("pain_points").notNull().default(""),
  proofPoints: text("proof_points").notNull().default(""),
  pitchRules: jsonb("pitch_rules").$type<RuleSet>().notNull().default({ do: [], dont: [] }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const writingStyles = pgTable("writing_styles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  rules: jsonb("rules").$type<RuleSet>().notNull().default({ do: [], dont: [] }),
  defaultProductId: uuid("default_product_id").references(() => products.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What changed on a writing style and why: packs applied, rules edited, rules learned. */
export const styleEvents = pgTable(
  "style_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    styleId: uuid("style_id")
      .notNull()
      .references(() => writingStyles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    description: text("description").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("style_events_style_at_idx").on(t.styleId, t.at)],
);

export type DraftSequence = {
  angle: string;
  messages: { step: "opener" | "follow_up_1" | "last_note"; body: string }[];
  warnings: string[];
};

/** Playground drafts, kept so the team can compare runs as rules change. */
export const playgroundRuns = pgTable(
  "playground_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    styleId: uuid("style_id")
      .notNull()
      .references(() => writingStyles.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    prospect: jsonb("prospect").$type<Record<string, string>>().notNull(),
    output: jsonb("output").$type<DraftSequence>().notNull(),
    model: text("model").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playground_runs_style_idx").on(t.styleId, t.createdAt)],
);

/** One row per Claude API call, for cost tracking and spend caps. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("ai_usage_at_idx").on(t.at)],
);

// ---------------------------------------------------------------------------
// Campaigns (Phase 4)

export const campaignStatus = pgEnum("campaign_status", ["draft", "running", "paused", "completed"]);

export type SequenceStep = {
  id: string;
  type: "invite" | "message";
  /** Days to wait after the previous step (for the first message: after the invite is accepted). */
  waitDays: number;
  /** invite: "blank" or "template". message: "ai" or "template". */
  mode: "blank" | "ai" | "template";
  /** Template text with {first_name}, {last_name}, {company}, {title}. */
  template: string;
  /** Sent instead of the template when a variable it uses is missing for a lead. */
  fallback: string;
};

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: campaignStatus("status").notNull().default("draft"),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  writingStyleId: uuid("writing_style_id").references(() => writingStyles.id, { onDelete: "set null" }),
  leadListId: uuid("lead_list_id").references(() => leadLists.id, { onDelete: "set null" }),
  playbook: text("playbook").notNull().default("curiosity"),
  steps: jsonb("steps").$type<SequenceStep[]>().notNull().default([]),
  timezone: text("timezone").notNull().default("America/New_York"),
  /** 0 = Sunday ... 6 = Saturday */
  activeDays: jsonb("active_days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  activeFrom: text("active_from").notNull().default("09:00"),
  activeTo: text("active_to").notNull().default("17:00"),
  dailyInviteLimit: integer("daily_invite_limit").notNull().default(10),
  dailyMessageLimit: integer("daily_message_limit").notNull().default(20),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignAccounts = pgTable(
  "campaign_accounts",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.accountId] })],
);

/**
 * pending      enrolled, not started
 * active       somewhere in the sequence
 * completed    every step done without a reply
 * replied      the prospect replied; remaining steps cancelled
 * failed       stopped by an error (see error)
 * skipped      not contacted (already in another campaign, or no usable profile)
 * excluded     removed by a person
 */
export const leadStateStatus = pgEnum("lead_state_status", [
  "pending",
  "active",
  "completed",
  "replied",
  "failed",
  "skipped",
  "excluded",
]);

export const leadState = pgTable(
  "lead_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    /** The one account that contacts this lead from invite to last message. */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    status: leadStateStatus("status").notNull().default("pending"),
    /** Index of the next step to run in campaigns.steps. */
    stepIndex: integer("step_index").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastActionAt: timestamp("last_action_at", { withTimezone: true }),
    note: text("note"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_state_campaign_lead_idx").on(t.campaignId, t.leadId),
    index("lead_state_due_idx").on(t.status, t.nextRunAt),
    index("lead_state_campaign_status_idx").on(t.campaignId, t.status),
  ],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type LeadList = typeof leadLists.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Product = typeof products.$inferSelect;
export type WritingStyle = typeof writingStyles.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
