"use client";

import { useActionState, useState, useTransition } from "react";
import { keepFieldsOnSubmit } from "@/components/use-keep-form";
import { CSV_FIELDS } from "@/lib/linkedin";
import type { CsvMapping } from "@/lib/linkedin";
import { createBasicSearch, createSalesNavImport, importCsv, previewCsv } from "../actions";
import type { CsvPreview, FormState } from "../actions";

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
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [reading, startReading] = useTransition();

  const onFile = (file: File | undefined) => {
    setPreview(null);
    setMapping({});
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startReading(async () => {
      const p = await previewCsv(fd);
      setPreview(p);
      setMapping(p.mapping ?? {});
    });
  };
  const usable = !!(mapping.profileUrl || mapping.firstName || mapping.fullName);

  return (
    <form onSubmit={keepFieldsOnSubmit(action)} className="card space-y-4 p-5">
      <Field label="List name">
        <input name="name" required defaultValue={state?.values?.name} className="input mt-1" />
      </Field>
      <Field label="CSV file" hint="Needs a header row. You can check and change how columns are matched before importing.">
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => onFile(e.target.files?.[0])}
          className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
        />
      </Field>

      {reading && <p className="text-sm text-muted">Reading the file…</p>}
      {preview?.error && <p role="alert" className="text-sm text-red-700">{preview.error}</p>}
      {preview?.headers && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Columns ({preview.rowCount?.toLocaleString()} rows)</legend>
          <p className="text-xs text-muted">
            Each row needs a LinkedIn profile URL, or a name and a company. Columns not chosen here are kept with the lead for personalization.
          </p>
          <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {CSV_FIELDS.map((f) => {
              const col = mapping[f.key];
              const sample = col ? preview.sample?.map((r) => r[col]).filter(Boolean).slice(0, 2).join(" · ") : "";
              return (
                <label key={f.key} className="block text-sm">
                  <span className="font-medium">{f.label}</span>
                  <select
                    value={col ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                    className="input mt-1"
                  >
                    <option value="">Not in this file</option>
                    {preview.headers!.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <span className="mt-0.5 block truncate text-xs text-muted">{sample ? `e.g. ${sample}` : "\u00a0"}</span>
                </label>
              );
            })}
          </div>
          {!usable && <p role="alert" className="text-sm text-amber-800">Choose the LinkedIn profile URL column, or a name column.</p>}
        </fieldset>
      )}

      <ErrorNote state={state} />
      <button type="submit" disabled={pending || reading || (!!preview?.headers && !usable)} className="btn btn-primary">
        {pending ? "Importing…" : preview?.rowCount ? `Import ${preview.rowCount.toLocaleString()} rows` : "Import"}
      </button>
    </form>
  );
}
