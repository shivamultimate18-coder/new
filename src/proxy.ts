import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Optimistic check only. Pages and actions re-check against the database (lib/auth.ts).
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = request.nextUrl.pathname === "/login";
  if (!session && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, static files, and the API routes that
  // Unipile calls (those verify their own signatures).
  matcher: ["/((?!_next/|favicon.ico|api/unipile/|api/health).*)"],
};
