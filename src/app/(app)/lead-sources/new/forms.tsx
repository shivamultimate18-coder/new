"use client";

import { useActionState } from "react";
import { createBasicSearch, createSalesNavImport, importCsv } from "../actions";
import type { FormState } from "../actions";

type AccountOption = { id: string; name: string };

function ErrorNote({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
      {state.error}
    </p>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

function AccountSelect({ accounts, value }: { accounts: AccountOption[]; value?: string }) {
  return (
    <select name="accountId" required defaultValue={value} className="input mt-1">
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
}

export function SalesNavForm({ accounts, maxPages }: { accounts: AccountOption[]; maxPages: number }) {
  const [state, action, pending] = useActionState(createSalesNavImport, null);
  const v = state?.values ?? {};
  return (
    <form action={action} className="card space-y-4 p-5" key={JSON.stringify(v)}>
      <Field label="List name">
        <input name="name" required defaultValue={v.name} placeholder="e.g. Austin paving owners" className="input mt-1" />
      </Field>
      <Field label="Sales Navigator account" hint="The search runs with this account's LinkedIn session.">
        <AccountSelect accounts={accounts} value={v.accountId} />
      </Field>
      <Field
        label="Sales Navigator search or lead list URL"
        hint="Run the search (or open a saved lead list) in Sales Navigator, then copy the whole address from the browser's address bar."
      >
        <input
          name="url"
          required
          defaultValue={v.url}
          placeholder="https://www.linkedin.com/sales/search/people?query=…"
          className="input mt-1 font-mono text-xs"
        />
      </Field>
      <Field
        label="Pages to import"
        hint={`25 leads per page. LinkedIn stops at ${maxPages} pages (2,500 leads); split bigger searches with more filters.`}
      >
        <input name="pages" type="number" min={1} max={maxPages} required defaultValue={v.pages ?? "4"} className="input mt-1 w-32" />
      </Field>
      <ErrorNote state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Starting…" : "Start import"}
      </button>
    </form>
  );
}

const SENIORITY = ["C-suite", "Founder", "Owner", "Partner", "VP", "Head", "Director"];

export function BasicSearchForm({ accounts, maxPages }: { accounts: AccountOption[]; maxPages: number }) {
  const [state, action, pending] = useActionState(createBasicSearch, null);
  const v = state?.values ?? {};
  return (
    <form action={action} className="card space-y-4 p-5" key={JSON.stringify(v)}>
      <Field label="List name">
        <input name="name" required defaultValue={v.name} placeholder="e.g. Dental clinic owners, Texas" className="input mt-1" />
      </Field>
      <Field label="LinkedIn account" hint="The search runs with this account's LinkedIn session.">
        <AccountSelect accounts={accounts} value={v.accountId} />
      </Field>
      <Field label="Keywords" hint="Words anywhere on the profile.">
        <input name="keywords" defaultValue={v.keywords} placeholder="e.g. dental clinic" className="input mt-1" />
      </Field>
      <Field label="Job title" hint='Optional. Use OR for alternatives, e.g. Founder OR Owner.'>
        <input name="title" defaultValue={v.title} className="input mt-1" />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium">Seniority</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SENIORITY.map((s) => (
            <label key={s} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
              <input type="checkbox" name="seniority" value={s} />
              {s}
            </label>
          ))}
        </div>
        <span className="mt-1 block text-xs text-muted">Matched by job title, so results are approximate.</span>
      </fieldset>
      <Field label="Locations" hint="Comma separated, e.g. Austin, Dallas. Each is matched to LinkedIn's closest place.">
        <input name="locations" defaultValue={v.locations} className="input mt-1" />
      </Field>
      <Field label="Industries" hint="Comma separated, e.g. Construction, Hospitals and Health Care.">
        <input name="industries" defaultValue={v.industries} className="input mt-1" />
      </Field>
      <Field label="Pages to import" hint={`25 leads per page, up to ${maxPages} pages (1,000 leads).`}>
        <input name="pages" type="number" min={1} max={maxPages} required defaultValue={v.pages ?? "4"} className="input mt-1 w-32" />
      </Field>
      <ErrorNote state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Starting…" : "Start search"}
      </button>
    </form>
  );
}

export function CsvForm() {
  const [state, action, pending] = useActionState(importCsv, null);
  return (
    <form action={action} className="card space-y-4 p-5">
      <Field label="List name">
        <input name="name" required defaultValue={state?.values?.name} className="input mt-1" />
      </Field>
      <Field
        label="CSV file"
        hint="Needs a header row. Columns are matched by name: LinkedIn URL, First name, Last name (or Name), Company, Title, Headline, Location, Industry, Email."
      >
        <input name="file" type="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm file:btn file:btn-secondary file:mr-3" />
      </Field>
      <ErrorNote state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Importing…" : "Import"}
      </button>
    </form>
  );
}
