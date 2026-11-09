"use client";

import { useActionState } from "react";
import { keepFieldsOnSubmit } from "@/components/use-keep-form";
import { addToDoNotContact, forgetPersonAction, setAiBudget } from "./actions";
import type { ListState } from "./actions";

function Note({ state }: { state: ListState }) {
  if (!state) return null;
  return (
    <>
      {state.message && <p role="status" className="text-sm text-emerald-700">{state.message}</p>}
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </>
  );
}

export function AddDoNotContactForm() {
  const [state, action, pending] = useActionState(addToDoNotContact, null);
  return (
    <form onSubmit={keepFieldsOnSubmit(action)} className="card space-y-3 p-4">
      <label className="block text-sm font-medium">
        LinkedIn profiles
        <span className="block text-xs font-normal text-muted">One link per line. Anyone in a running campaign is stopped at once.</span>
        <textarea name="profiles" rows={4} placeholder="https://www.linkedin.com/in/someone" className="input mt-1.5 font-mono text-xs" />
      </label>
      <label className="block text-sm font-medium">
        Reason
        <input name="reason" placeholder="e.g. existing customer, asked not to be contacted" className="input mt-1 max-w-md" />
      </label>
      <button type="submit" disabled={pending} className="btn btn-primary">{pending ? "Adding…" : "Add to the list"}</button>
      <Note state={state} />
    </form>
  );
}

export function ForgetPersonForm() {
  const [state, action, pending] = useActionState(forgetPersonAction, null);
  return (
    <form
      onSubmit={(e) => {
        if (!window.confirm("Permanently delete everything stored about this person? This cannot be undone.")) {
          e.preventDefault();
          return;
        }
        keepFieldsOnSubmit(action)(e);
      }}
      className="card space-y-3 border-red-200 p-4"
    >
      <h2 className="font-medium">Delete a person&apos;s data</h2>
      <p className="text-sm text-muted">
        For a privacy request. Deletes their leads in every list, campaign progress, drafts, conversations and messages. Only their LinkedIn identifier is kept, on the do-not-contact list, so they are never imported again.
      </p>
      <label className="block text-sm font-medium">
        LinkedIn profile
        <input name="profile" required placeholder="https://www.linkedin.com/in/someone" className="input mt-1 max-w-md font-mono text-xs" />
      </label>
      <button type="submit" disabled={pending} className="btn btn-danger">{pending ? "Deleting…" : "Delete their data"}</button>
      <Note state={state} />
    </form>
  );
}

export function BudgetForm({ current }: { current: number | null }) {
  const [state, action, pending] = useActionState(setAiBudget, null);
  return (
    <form onSubmit={keepFieldsOnSubmit(action)} className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium">
        Monthly limit (US$)
        <span className="block text-xs font-normal text-muted">Leave empty for no limit.</span>
        <input name="budget" type="number" min={0} step={1} defaultValue={current ?? ""} className="input mt-1 w-40" />
      </label>
      <button type="submit" disabled={pending} className="btn btn-primary">Save</button>
      <Note state={state} />
    </form>
  );
}
