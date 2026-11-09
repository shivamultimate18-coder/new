import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
