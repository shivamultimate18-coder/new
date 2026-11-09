import type { Metadata } from "next";
import { and, asc, count, eq, gte, inArray } from "drizzle-orm";
import { ConfirmButton } from "@/components/confirm-button";
import { db, schema } from "@/db";
import { hoursAgo } from "@/lib/time";
import type { Account } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  connectAccount,
  reconnectAccount,
  removeAccount,
  setEnabled,
  setSalesNav,
} from "./actions";

// Every page here is per-user and reads the session cookie, so it renders on request.
export const instant = false;

export const metadata: Metadata = { title: "Accounts" };

const STATUS: Record<Account["status"], { label: string; tone: string }> = {
  pending: { label: "Waiting for sign-in", tone: "bg-amber-50 text-amber-800" },
  ok: { label: "Connected", tone: "bg-emerald-50 text-emerald-800" },
  needs_reconnect: { label: "Needs reconnect", tone: "bg-red-50 text-red-800" },
  error: { label: "Error", tone: "bg-red-50 text-red-800" },
  disconnected: { label: "Disconnected", tone: "bg-zinc-100 text-zinc-700" },
};

const NOTICES: Record<string, { text: string; tone: string }> = {
  "connected=1": {
    text: "Sign-in finished. The account shows as Connected once Unipile confirms it, usually within a few seconds. Refresh if it still says waiting.",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  "connected=0": {
    text: "The LinkedIn sign-in did not finish. Try connecting again.",
    tone: "border-red-200 bg-red-50 text-red-900",
  },
  "error=link": {
    text: "Could not create a sign-in link. Check the Unipile settings and try again.",
    tone: "border-red-200 bg-red-50 text-red-900",
  },
  "error=remove": {
    text: "Could not remove the account from Unipile, so it was kept here. Try again.",
    tone: "border-red-200 bg-red-50 text-red-900",
  },
};

function ago(d: Date | null): string {
  if (!d) return "Never";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.floor(mins / (60 * 24));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const user = await requireUser();
  const sp = await searchParams;
  const notice =
    NOTICES[`connected=${sp.connected}`] ?? NOTICES[`error=${sp.error}`] ?? null;

  const rows = await db
    .select({ account: schema.accounts, ownerName: schema.users.name })
    .from(schema.accounts)
    .leftJoin(schema.users, eq(schema.users.id, schema.accounts.ownerUserId))
    .orderBy(asc(schema.accounts.createdAt));

  // Sending in the last 24 hours, per account (the engine's limits are rolling 24 hours).
  const since = hoursAgo(24);
  const activity = await db
    .select({ accountId: schema.activityLog.accountId, type: schema.activityLog.type, n: count() })
    .from(schema.activityLog)
    .where(and(gte(schema.activityLog.at, since), inArray(schema.activityLog.type, ["invite.sent", "message.sent"])))
    .groupBy(schema.activityLog.accountId, schema.activityLog.type);
  const sent = (id: string, type: string) => activity.find((r) => r.accountId === id && r.type === type)?.n ?? 0;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="mt-1 text-sm text-muted">
            LinkedIn accounts used for outreach. Each person signs in on a secure Unipile page, so
            no LinkedIn passwords are stored here.
          </p>
        </div>
        <form action={connectAccount}>
          <button type="submit" className="btn btn-primary">
            Connect account
          </button>
        </form>
      </div>

      {notice && (
        <p role="status" className={`mt-4 rounded-lg border px-4 py-3 text-sm ${notice.tone}`}>
          {notice.text}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <p className="font-medium">No accounts yet</p>
          <p className="mt-1 text-sm text-muted">
            Connect your own LinkedIn account to get started. Teammates connect theirs after
            signing in here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ account: a, ownerName }) => {
            const canManage = user.role === "admin" || a.ownerUserId === user.id;
            const status = STATUS[a.status];
            return (
              <li key={a.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.name || "LinkedIn account"}</div>
                    <div className="truncate text-sm text-muted">
                      {a.publicIdentifier ? (
                        <a
                          href={`https://www.linkedin.com/in/${encodeURIComponent(a.publicIdentifier)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          linkedin.com/in/{a.publicIdentifier}
                        </a>
                      ) : (
                        `Owner: ${ownerName ?? "nobody"}`
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <form action={setEnabled}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="enabled" value={a.enabled ? "0" : "1"} />
                      <button
                        type="submit"
                        role="switch"
                        aria-checked={a.enabled}
                        aria-label={`Sending for ${a.name || "account"}`}
                        disabled={!a.enabled && a.status !== "ok"}
                        title={
                          a.status === "ok" || a.enabled
                            ? "Switch sending on or off"
                            : "Connect the account before switching it on"
                        }
                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          a.enabled ? "bg-brand" : "bg-zinc-300"
                        }`}
                      >
                        <span
                          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            a.enabled ? "translate-x-5" : ""
                          }`}
                        />
                      </button>
                    </form>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className={`rounded-full px-2 py-0.5 ${status.tone}`}>{status.label}</span>
                  {a.status === "ok" && !a.enabled && a.pausedReason && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">Paused by the sending engine</span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      a.enabled ? "bg-blue-50 text-blue-800" : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {a.enabled ? "Sending on" : "Sending off"}
                  </span>
                  {a.hasSalesNav && (
                    <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-yellow-800">
                      Sales Navigator
                    </span>
                  )}
                </div>

                {a.pausedReason && <p className="mt-3 text-sm text-red-800">{a.pausedReason}</p>}

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted">Connected</dt>
                    <dd>{ago(a.connectedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Last activity</dt>
                    <dd>{ago(a.lastActivityAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Invites, last 24 h</dt>
                    <dd className="tabular-nums">
                      {sent(a.id, "invite.sent")} of {a.dailyInviteLimit}
                      {a.dailyInviteLimit < 15 && <span className="text-xs text-muted"> · warming up</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Messages, last 24 h</dt>
                    <dd className="tabular-nums">{sent(a.id, "message.sent")} of {a.dailyMessageLimit}</dd>
                  </div>
                </dl>

                {canManage && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                    {a.status !== "ok" && (
                      <form action={reconnectAccount}>
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" className="btn btn-primary">
                          {a.status === "pending" ? "Continue sign-in" : "Reconnect"}
                        </button>
                      </form>
                    )}
                    <form action={setSalesNav}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="value" value={a.hasSalesNav ? "0" : "1"} />
                      <button type="submit" className="btn btn-secondary">
                        {a.hasSalesNav ? "Unmark Sales Navigator" : "Mark as Sales Navigator"}
                      </button>
                    </form>
                    <form action={removeAccount} className="ml-auto">
                      <input type="hidden" name="id" value={a.id} />
                      <ConfirmButton
                        message={`Remove ${a.name || "this account"}? It will be disconnected from Unipile.`}
                        className="btn btn-danger"
                      >
                        Remove
                      </ConfirmButton>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
