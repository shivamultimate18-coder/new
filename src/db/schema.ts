import {
  bigserial,
  boolean,
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

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type LeadList = typeof leadLists.$inferSelect;
export type Lead = typeof leads.$inferSelect;
