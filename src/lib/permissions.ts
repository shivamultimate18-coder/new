import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";

/** LinkedIn accounts this person may run searches with: their own, or all for admins. */
export async function usableAccounts(user: CurrentUser, opts: { salesNavOnly?: boolean } = {}) {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.status, "ok"),
        opts.salesNavOnly ? eq(schema.accounts.hasSalesNav, true) : undefined,
        user.role === "admin" ? undefined : eq(schema.accounts.ownerUserId, user.id),
      ),
    );
  return rows;
}

/** Lead lists are shared across the team; only the creator or an admin may change them. */
export function canManageList(user: CurrentUser, list: { createdByUserId: string | null }) {
  return user.role === "admin" || list.createdByUserId === user.id;
}
