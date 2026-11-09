import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAccountProfile } from "./unipile";

type Status = (typeof schema.accountStatus.enumValues)[number];

/** Called when a hosted login (first connection or reconnect) succeeds. */
export async function completeConnection(rowId: string, unipileAccountId: string) {
  const [row] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, rowId));
  if (!row) return false;

  // Profile lookup is best effort; the connection itself already succeeded.
  const profile = await getAccountProfile(unipileAccountId).catch(() => null);

  await db
    .update(schema.accounts)
    .set({
      unipileAccountId,
      status: "ok",
      pausedReason: null,
      connectedAt: new Date(),
      ...(profile
        ? {
            name: profile.name || row.name,
            publicIdentifier: profile.publicIdentifier,
            providerId: profile.providerId,
            // Only ever switch the flag on automatically; a person can correct it by hand.
            hasSalesNav: row.hasSalesNav || profile.hasSalesNav,
          }
        : {}),
    })
    .where(eq(schema.accounts.id, rowId));
  await db.insert(schema.activityLog).values({
    accountId: rowId,
    userId: row.ownerUserId,
    type: row.unipileAccountId ? "account.reconnected" : "account.connected",
  });
  return true;
}

// Unipile account_status messages -> our status.
const STATUS_MAP: Record<string, { status: Status; reason: string | null } | undefined> = {
  OK: { status: "ok", reason: null },
  SYNC_SUCCESS: { status: "ok", reason: null },
  RECONNECTED: { status: "ok", reason: null },
  CREATION_SUCCESS: { status: "ok", reason: null },
  CREDENTIALS: { status: "needs_reconnect", reason: "LinkedIn session expired. Sign in again." },
  ERROR: { status: "error", reason: "Unipile reported an error on this account." },
  STOPPED: { status: "error", reason: "Unipile stopped syncing this account." },
  DELETED: { status: "disconnected", reason: "The account was removed from Unipile." },
  PERMISSIONS: { status: "error", reason: "Unipile reports missing permissions on this account." },
  CREATION_FAIL: { status: "error", reason: "Connecting the account failed. Try connecting it again." },
};

export async function applyUnipileStatus(unipileAccountId: string, message: string) {
  const mapped = STATUS_MAP[message.toUpperCase()];
  if (!mapped) return; // CONNECTING and anything unknown: no change
  const [row] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.unipileAccountId, unipileAccountId));
  if (!row) return;
  // Unipile: a new account can need a few seconds before it answers requests, so the profile
  // fetch at connection can fail. Fill in the name and member id once it reports OK.
  if (mapped.status === "ok" && (!row.providerId || !row.publicIdentifier)) {
    const profile = await getAccountProfile(unipileAccountId).catch(() => null);
    if (profile) {
      await db
        .update(schema.accounts)
        .set({
          name: profile.name || row.name,
          publicIdentifier: profile.publicIdentifier ?? row.publicIdentifier,
          providerId: profile.providerId ?? row.providerId,
          hasSalesNav: row.hasSalesNav || profile.hasSalesNav,
        })
        .where(eq(schema.accounts.id, row.id));
    }
  }
  if (row.status === mapped.status) return;
  await db
    .update(schema.accounts)
    .set({
      status: mapped.status,
      pausedReason: mapped.reason,
      // Any problem pauses sending (plan section 5). Someone switches it back on after reconnecting.
      ...(mapped.status !== "ok" ? { enabled: false } : {}),
    })
    .where(eq(schema.accounts.id, row.id));
  await db.insert(schema.activityLog).values({
    accountId: row.id,
    type: "account.status",
    detail: { from: row.status, to: mapped.status, unipile: message, pausedSending: row.enabled && mapped.status !== "ok" },
  });
}
