import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { setActive } from "./actions";
import { AddMemberForm, ResetPasswordForm } from "./forms";

// Every page here is per-user and reads the session cookie, so it renders on request.
export const instant = false;

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const admin = await requireAdmin();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold">Team</h1>
      <p className="mt-1 text-sm text-muted">
        Logins for this tool. Members manage their own LinkedIn accounts; admins manage everyone&apos;s.
      </p>
      <div className="mt-6">
        <AddMemberForm />
      </div>
      <ul className="card mt-6 divide-y divide-line">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="font-medium">
                {u.name} {!u.active && <span className="text-sm font-normal text-muted">(deactivated)</span>}
              </div>
              <div className="text-sm text-muted">
                {u.email} · {u.role === "admin" ? "Admin" : "Member"}
              </div>
            </div>
            {u.id !== admin.id && (
              <div className="flex flex-wrap items-start gap-2">
                <ResetPasswordForm id={u.id} />
                <form action={setActive}>
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                  <button type="submit" className={u.active ? "btn btn-danger" : "btn btn-secondary"}>
                    {u.active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
