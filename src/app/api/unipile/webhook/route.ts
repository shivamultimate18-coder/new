import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { applyUnipileStatus } from "@/lib/accounts";
import { env } from "@/lib/env";

// Account-status webhook. New-message and invite-accepted events arrive in later phases.
const Body = z.object({
  AccountStatus: z.object({ account_id: z.string().min(1), message: z.string() }),
});

export async function POST(request: NextRequest) {
  const given = Buffer.from(request.headers.get("x-webhook-secret") ?? "");
  const expected = Buffer.from(env.UNIPILE_WEBHOOK_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  // Acknowledge event types we do not handle yet so Unipile does not retry them.
  if (!parsed.success) return NextResponse.json({ ok: true, ignored: true });
  await applyUnipileStatus(parsed.data.AccountStatus.account_id, parsed.data.AccountStatus.message);
  return NextResponse.json({ ok: true });
}
