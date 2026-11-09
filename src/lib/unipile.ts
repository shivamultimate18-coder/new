import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * The only module that talks to Unipile. Request and response shapes follow
 * Unipile's hosted auth and account docs as of 2026; check them against
 * https://developer.unipile.com before the first real connection.
 */

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://${env.UNIPILE_DSN}/api/v1${path}`, {
    method,
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Unipile ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Signs our account row id so the hosted-login callback cannot be forged. */
export function signRowId(rowId: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`unipile-link:${rowId}`).digest("hex");
}

export function verifyRowId(rowId: string, sig: string | null): boolean {
  if (!sig) return false;
  const a = Buffer.from(signRowId(rowId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Returns a URL on Unipile's hosted login page. The person signs in to LinkedIn
 * there; we never see or store their password or 2FA secret.
 */
export async function createHostedAuthLink(opts: {
  rowId: string;
  reconnectUnipileAccountId?: string;
}): Promise<string> {
  const sig = signRowId(opts.rowId);
  if (env.UNIPILE_MOCK) {
    return `/dev/mock-connect?name=${opts.rowId}&sig=${sig}`;
  }
  const { url } = await call<{ url: string }>("POST", "/hosted/accounts/link", {
    type: opts.reconnectUnipileAccountId ? "reconnect" : "create",
    ...(opts.reconnectUnipileAccountId
      ? { reconnect_account: opts.reconnectUnipileAccountId }
      : { providers: ["LINKEDIN"] }),
    api_url: `https://${env.UNIPILE_DSN}`,
    expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    name: opts.rowId,
    notify_url: `${env.APP_URL}/api/unipile/hosted-callback?sig=${sig}`,
    success_redirect_url: `${env.APP_URL}/accounts?connected=1`,
    failure_redirect_url: `${env.APP_URL}/accounts?connected=0`,
  });
  return url;
}

export type UnipileProfile = {
  name: string;
  publicIdentifier: string | null;
  hasSalesNav: boolean;
};

type UnipileAccount = {
  id: string;
  name?: string;
  connection_params?: {
    im?: { publicIdentifier?: string; username?: string; premiumFeatures?: string[] };
  };
};

export async function getAccountProfile(unipileAccountId: string): Promise<UnipileProfile> {
  if (env.UNIPILE_MOCK) {
    return { name: "Mock account", publicIdentifier: "mock-account", hasSalesNav: false };
  }
  const a = await call<UnipileAccount>("GET", `/accounts/${encodeURIComponent(unipileAccountId)}`);
  const im = a.connection_params?.im;
  return {
    name: a.name ?? im?.username ?? "",
    publicIdentifier: im?.publicIdentifier ?? null,
    hasSalesNav: (im?.premiumFeatures ?? []).some((f) => /sales[_ ]?nav/i.test(f)),
  };
}

export async function deleteAccount(unipileAccountId: string): Promise<void> {
  if (env.UNIPILE_MOCK) return;
  await call("DELETE", `/accounts/${encodeURIComponent(unipileAccountId)}`);
}

/** Registers the account-status webhook. Run once per deployment (scripts/register-webhooks.ts). */
export async function registerAccountStatusWebhook(): Promise<unknown> {
  return call("POST", "/webhooks", {
    source: "account_status",
    name: "account-status",
    request_url: `${env.APP_URL}/api/unipile/webhook`,
    headers: [{ key: "x-webhook-secret", value: env.UNIPILE_WEBHOOK_SECRET }],
  });
}

export function mockAccountId(): string {
  return `mock_${randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// LinkedIn search (Phase 2). Unipile runs the search with the account's own
// LinkedIn session. Endpoint and field names follow Unipile's LinkedIn search
// docs; verify against https://developer.unipile.com/docs/linkedin-search.

export type SearchBody =
  | { api: "sales_navigator"; category: "people"; url: string }
  | {
      api: "classic";
      category: "people";
      keywords?: string;
      location?: string[];
      industry?: string[];
      advanced_keywords?: { title?: string };
    };

export type SearchItem = Record<string, unknown>;
export type SearchPage = { items: SearchItem[]; cursor: string | null; totalCount: number | null };

export async function searchPeople(opts: {
  unipileAccountId: string;
  body: SearchBody;
  cursor: string | null;
  limit: number;
}): Promise<SearchPage> {
  const q = new URLSearchParams({ account_id: opts.unipileAccountId, limit: String(opts.limit) });
  if (opts.cursor) q.set("cursor", opts.cursor);
  const res = await call<{
    items?: SearchItem[];
    cursor?: string | null;
    paging?: { total_count?: number | null };
  }>("POST", `/linkedin/search?${q}`, opts.body);
  return {
    items: res.items ?? [],
    cursor: res.cursor ?? null,
    totalCount: res.paging?.total_count ?? null,
  };
}

/** Resolves a typed place or industry name to LinkedIn's id for use in a classic search. */
export async function lookupSearchParameter(opts: {
  unipileAccountId: string;
  type: "LOCATION" | "INDUSTRY";
  keywords: string;
}): Promise<{ id: string; title: string } | null> {
  if (env.UNIPILE_MOCK) return { id: `mock-${opts.type.toLowerCase()}`, title: opts.keywords };
  const q = new URLSearchParams({
    account_id: opts.unipileAccountId,
    type: opts.type,
    keywords: opts.keywords,
    limit: "1",
  });
  const res = await call<{ items?: { id: string; title: string }[] }>(
    "GET",
    `/linkedin/search/parameters?${q}`,
  );
  return res.items?.[0] ?? null;
}

/** Errors that will not go away by retrying (bad URL, no Sales Navigator, auth). */
export function isPermanentUnipileError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : "";
  return /failed: (400|401|403|404|422)\b/.test(m);
}
