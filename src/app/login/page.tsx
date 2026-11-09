import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/env";
import { LoginForm } from "./login-form";

// Every page here is per-user and reads the session cookie, so it renders on request.
export const instant = false;

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/accounts");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">{APP_NAME}</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Sign in with your team login.</p>
        <LoginForm />
      </div>
    </main>
  );
}
