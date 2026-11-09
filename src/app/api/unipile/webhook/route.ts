import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { applyUnipileStatus } from "@/lib/accounts";
import { handleIncomingMessage, handleNewRelation } from "@/lib/engine/engine";
import { env } from "@/lib/env";

// Unipile webhooks: account status, new messages (replies) and new relations (accepted invites).
// Payload shapes follow Unipile's webhook docs; unknown events are acknowledged and ignored.
const AccountStatus = z.object({
  AccountStatus: z.object({ account_id: z.string().min(1), message: z.string() }),
});
const MessageReceived = z.object({
  event: z.literal("message_received"),
  account_id: z.string().min(1),
  chat_id: z.string().min(1),
  sender: z.object({ attendee_provider_id: z.string().nullish() }).passthrough(),
});
const NewRelation = z.object({
  event: z.literal("new_relation"),
  account_id: z.string().min(1),
  user_provider_id: z.string().nullish(),
  user_public_identifier: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  const given = Buffer.from(request.headers.get("x-webhook-secret") ?? "");
  const expected = Buffer.from(env.UNIPILE_WEBHOOK_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);

  const status = AccountStatus.safeParse(body);
  if (status.success) {
    await applyUnipileStatus(status.data.AccountStatus.account_id, status.data.AccountStatus.message);
    return NextResponse.json({ ok: true });
  }
  const message = MessageReceived.safeParse(body);
  if (message.success) {
    await handleIncomingMessage(message.data.account_id, message.data.chat_id, message.data.sender.attendee_provider_id ?? null);
    return NextResponse.json({ ok: true });
  }
  const relation = NewRelation.safeParse(body);
  if (relation.success) {
    await handleNewRelation(relation.data.account_id, relation.data.user_provider_id ?? null, relation.data.user_public_identifier ?? null);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true, ignored: true });
}
