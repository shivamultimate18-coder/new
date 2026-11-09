import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { completeConnection } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { mockAccountId, verifyRowId } from "@/lib/unipile";

// Development only: stands in for Unipile's hosted LinkedIn sign-in page when UNIPILE_MOCK=1.
export const instant = false;

async function finish(formData: FormData) {
  "use server";
  if (!env.UNIPILE_MOCK) notFound();
  await requireUser();
  const rowId = String(formData.get("name"));
  if (!verifyRowId(rowId, String(formData.get("sig")))) notFound();
  const [row] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, rowId));
  if (!row) notFound();
  await completeConnection(rowId, row.unipileAccountId ?? mockAccountId());
  redirect("/accounts?connected=1");
}

export default async function MockConnectPage({ searchParams }: PageProps<"/dev/mock-connect">) {
  if (!env.UNIPILE_MOCK) notFound();
  await requireUser();
  const sp = await searchParams;
  const name = typeof sp.name === "string" ? sp.name : "";
  const sig = typeof sp.sig === "string" ? sp.sig : "";
  if (!verifyRowId(name, sig)) notFound();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Mock mode</p>
        <h1 className="mt-1 text-lg font-semibold">Simulated LinkedIn sign-in</h1>
        <p className="mt-1 text-sm text-muted">
          With Unipile configured, this is Unipile&apos;s hosted sign-in page instead.
        </p>
        <form action={finish} className="mt-5 flex gap-2">
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="sig" value={sig} />
          <button type="submit" className="btn btn-primary">Finish sign-in</button>
          <a href="/accounts?connected=0" className="btn btn-secondary">Cancel</a>
        </form>
      </div>
    </main>
  );
}
