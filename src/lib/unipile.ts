import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * The only module that talks to Unipile. Request and response shapes follow
 * Unipile's hosted auth and account docs as of 2026; check them against
 * https://developer.unipile.com before the first real connection.
 */

/** An error response from Unipile, with the HTTP status and Unipile's error type (e.g. "errors/disconnected_account"). */
export class UnipileError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`https://${env.UNIPILE_DSN}/api/v1${path}`, {
    method,
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      accept: "application/json",
      ...(body && !isForm ? { "content-type": "application/json" } : {}),
    },
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let type = "";
    try {
      const j = JSON.parse(text) as { type?: string };
      type = j.type ?? "";
    } catch {}
    throw new UnipileError(res.status, type, `Unipile ${method} ${path.split("?")[0]} failed: ${res.status} ${text.slice(0, 300)}`);
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
  /** The account's own LinkedIn member id. */
  providerId: string | null;
  publicIdentifier: string | null;
  hasSalesNav: boolean;
};

type UnipileAccount = {
  id: string;
  name?: string;
  connection_params?: {
    im?: { id?: string; publicIdentifier?: string; username?: string; premiumFeatures?: string[] };
  };
};

export async function getAccountProfile(unipileAccountId: string): Promise<UnipileProfile> {
  if (env.UNIPILE_MOCK) {
    return { name: "Mock account", providerId: `MOCKSELF-${unipileAccountId}`, publicIdentifier: "mock-account", hasSalesNav: false };
  }
  const a = await call<UnipileAccount>("GET", `/accounts/${encodeURIComponent(unipileAccountId)}`);
  const im = a.connection_params?.im;
  return {
    name: a.name ?? im?.username ?? "",
    providerId: im?.id ?? null,
    publicIdentifier: im?.publicIdentifier ?? null,
    hasSalesNav: (im?.premiumFeatures ?? []).some((f) => /sales[_ ]?nav/i.test(f)),
  };
}

export async function deleteAccount(unipileAccountId: string): Promise<void> {
  if (env.UNIPILE_MOCK) return;
  await call("DELETE", `/accounts/${encodeURIComponent(unipileAccountId)}`);
}

/**
 * Registers our webhooks: account status, new messages (replies) and new relations
 * (accepted invites). Run once per deployment (scripts/register-webhooks.ts).
 */
export async function registerWebhooks(): Promise<unknown[]> {
  const common = {
    request_url: `${env.APP_URL}/api/unipile/webhook`,
    headers: [{ key: "x-webhook-secret", value: env.UNIPILE_WEBHOOK_SECRET }],
  };
  return Promise.all([
    call("POST", "/webhooks", { ...common, source: "account_status", name: "account-status" }),
    call("POST", "/webhooks", { ...common, source: "messaging", name: "messages", events: ["message_received"] }),
    call("POST", "/webhooks", { ...common, source: "users", name: "relations", events: ["new_relation"] }),
  ]);
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
  return e instanceof UnipileError && [400, 401, 403, 404, 422].includes(e.status);
}

// ---------------------------------------------------------------------------
// Sending (Phase 5). Shapes follow Unipile's users and messaging docs; verify before going live.

export type LinkedInProfile = {
  /** Selected profile fields kept for drafting. */
  details: Record<string, unknown>;
  providerId: string;
  publicIdentifier: string | null;
  /** FIRST_DEGREE means already connected. */
  networkDistance: string | null;
  /** True when an invitation from this account is already pending. */
  invitePending: boolean;
};

export async function getProfile(unipileAccountId: string, identifier: string): Promise<LinkedInProfile> {
  const r = await call<{
    provider_id: string;
    public_identifier?: string | null;
    network_distance?: string | null;
    invitation?: { type?: string; status?: string } | null;
    headline?: string | null;
    summary?: string | null;
    location?: string | null;
  }>("GET", `/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(unipileAccountId)}`);
  return {
    details: { headline: r.headline ?? null, summary: r.summary ?? null, location: r.location ?? null },
    providerId: r.provider_id,
    publicIdentifier: r.public_identifier ?? null,
    networkDistance: r.network_distance ?? null,
    invitePending: r.invitation?.type === "SENT" && r.invitation?.status === "PENDING",
  };
}

export async function sendInvite(unipileAccountId: string, providerId: string, note: string | null): Promise<void> {
  await call("POST", "/users/invite", {
    account_id: unipileAccountId,
    provider_id: providerId,
    ...(note ? { message: note } : {}),
  });
}

/**
 * Starts a chat with a first message, or adds to the existing one. Returns the chat id and
 * Unipile's message id, which is stored so webhook echoes and Sync do not duplicate it.
 */
export async function sendMessage(opts: {
  unipileAccountId: string;
  providerId: string;
  chatId: string | null;
  text: string;
}): Promise<{ chatId: string; messageId: string | null }> {
  const form = new FormData();
  form.set("text", opts.text);
  if (opts.chatId) {
    const r = await call<{ message_id?: string | null }>("POST", `/chats/${encodeURIComponent(opts.chatId)}/messages`, form);
    return { chatId: opts.chatId, messageId: r.message_id ?? null };
  }
  form.set("account_id", opts.unipileAccountId);
  form.append("attendees_ids", opts.providerId);
  const r = await call<{ chat_id: string; message_id?: string | null }>("POST", "/chats", form);
  return { chatId: r.chat_id, messageId: r.message_id ?? null };
}

export type ChatMessage = { id: string; text: string; fromProspect: boolean; at: string };

export async function recentChatMessages(chatId: string, limit = 20): Promise<ChatMessage[]> {
  const r = await call<{ items?: { id: string; text?: string | null; is_sender?: number | boolean; timestamp?: string }[] }>(
    "GET",
    `/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
  );
  return (r.items ?? []).map((m) => ({
    id: m.id,
    text: m.text ?? "",
    fromProspect: !(m.is_sender === 1 || m.is_sender === true),
    at: m.timestamp ?? "",
  }));
}

export type Relation = { providerId: string | null; publicIdentifier: string | null };

/** The account's most recent connections, newest first. */
export async function recentRelations(unipileAccountId: string, limit = 100): Promise<Relation[]> {
  const r = await call<{ items?: { member_id?: string; public_identifier?: string }[] }>(
    "GET",
    `/users/relations?account_id=${encodeURIComponent(unipileAccountId)}&limit=${limit}`,
  );
  return (r.items ?? []).map((x) => ({ providerId: x.member_id ?? null, publicIdentifier: x.public_identifier?.toLowerCase() ?? null }));
}

/** Recent chats on an account, newest first (Inbox sync). */
export type ChatSummary = { id: string; attendeeProviderId: string | null; name: string | null; at: string | null };

export async function recentChats(unipileAccountId: string, limit = 30): Promise<ChatSummary[]> {
  const r = await call<{ items?: { id: string; attendee_provider_id?: string | null; name?: string | null; timestamp?: string | null }[] }>(
    "GET",
    `/chats?account_id=${encodeURIComponent(unipileAccountId)}&limit=${limit}`,
  );
  return (r.items ?? []).map((c) => ({ id: c.id, attendeeProviderId: c.attendee_provider_id ?? null, name: c.name ?? null, at: c.timestamp ?? null }));
}
