"use client";

import { useActionState } from "react";
import { addMember, resetPassword } from "./actions";
import type { AddResult } from "./actions";

function Result({ state }: { state: AddResult }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (!state.created) return null;
  return (
    <p role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      Password for {state.created.email}: <code className="select-all font-mono">{state.created.password}</code>
      <br />
      Shown once. Send it privately; it cannot be viewed again.
    </p>
  );
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMember, null);
  return (
    <form action={action} className="card p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="text-sm font-medium">
          Name
          <input name="name" required className="input mt-1" />
        </label>
        <label className="text-sm font-medium">
          Email
          <input name="email" type="email" required className="input mt-1" />
        </label>
        <label className="text-sm font-medium">
          Role
          <select name="role" className="input mt-1">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary">
          Add person
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ResetPasswordForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(resetPassword, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        Reset password
      </button>
      <Result state={state} />
    </form>
  );
}
