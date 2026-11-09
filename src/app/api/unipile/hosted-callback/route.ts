import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { completeConnection } from "@/lib/accounts";
import { verifyRowId } from "@/lib/unipile";

// Unipile POSTs here when someone finishes the hosted login.
const Body = z.object({
  status: z.string(),
  account_id: z.string().min(1),
  name: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { status, account_id, name } = parsed.data;
  if (!verifyRowId(name, request.nextUrl.searchParams.get("sig"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  if (status === "CREATION_SUCCESS" || status === "RECONNECTED") {
    await completeConnection(name, account_id);
  }
  return NextResponse.json({ ok: true });
}
