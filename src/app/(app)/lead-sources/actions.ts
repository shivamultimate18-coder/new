"use server";

import Papa from "papaparse";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { MAX_PAGES, insertLeads, scheduleNextPage } from "@/lib/imports";
import { CSV_FIELDS, checkSalesNavUrl, leadFromCsvRow, mapCsvHeaders } from "@/lib/linkedin";
import type { CsvMapping, LeadInput } from "@/lib/linkedin";
import { canManageList, usableAccounts } from "@/lib/permissions";
import { lookupSearchParameter } from "@/lib/unipile";
import type { SearchBody } from "@/lib/unipile";

export type FormState = { error?: string; values?: Record<string, string> } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const valuesOf = (fd: FormData) =>
  Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

function pagesFrom(fd: FormData, max: number): number | null {
  const n = Number(str(fd, "pages"));
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

async function startSearchList(opts: {
  userId: string;
  name: string;
  source: "sales_nav" | "basic_search";
  accountId: string;
  params: SearchBody & { display?: Record<string, string> };
  pages: number;
}): Promise<string> {
  const [list] = await db
    .insert(schema.leadLists)
    .values({
      name: opts.name,
      source: opts.source,
      accountId: opts.accountId,
      createdByUserId: opts.userId,
      params: opts.params,
      pagesRequested: opts.pages,
      status: "queued",
    })
    .returning();
  try {
    await scheduleNextPage(list.id, 0, "queued");
  } catch (e) {
    console.error(e);
    await db
      .update(schema.leadLists)
      .set({ status: "failed", error: "Could not queue the import. Is the worker database reachable?" })
      .where(eq(schema.leadLists.id, list.id));
  }
  return list.id;
}

export async function createSalesNavImport(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = valuesOf(fd);
  const name = str(fd, "name");
  const url = str(fd, "url");
  const pages = pagesFrom(fd, MAX_PAGES.sales_nav);
  if (!name) return { error: "Give the list a name.", values };
  const urlError = checkSalesNavUrl(url);
  if (urlError) return { error: urlError, values };
  if (!pages) return { error: `Pages must be a whole number from 1 to ${MAX_PAGES.sales_nav}.`, values };
  const accounts = await usableAccounts(user, { salesNavOnly: true });
  const account = accounts.find((a) => a.id === str(fd, "accountId"));
  if (!account) return { error: "Choose a connected account with Sales Navigator.", values };

  const id = await startSearchList({
    userId: user.id,
    name,
    source: "sales_nav",
    accountId: account.id,
    params: { api: "sales_navigator", category: "people", url },
    pages,
  });
  redirect(`/lead-sources/${id}`);
}

// Seniority is applied as job-title keywords, because LinkedIn's standard search has no
// seniority filter (Sales Navigator does; use that import for precise seniority).
const SENIORITY_TITLES: Record<string, string> = {
  "C-suite": "CEO OR CTO OR CFO OR COO OR CMO OR CRO OR Chief",
  Founder: "Founder OR Co-Founder OR Cofounder",
  Owner: "Owner",
  Partner: "Partner",
  VP: "VP OR \"Vice President\"",
  Head: "Head",
  Director: "Director",
};

export async function createBasicSearch(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = valuesOf(fd);
  const name = str(fd, "name");
  const keywords = str(fd, "keywords");
  const title = str(fd, "title");
  const seniority = fd.getAll("seniority").map(String).filter((s) => s in SENIORITY_TITLES);
  const locations = str(fd, "locations").split(",").map((s) => s.trim()).filter(Boolean);
  const industries = str(fd, "industries").split(",").map((s) => s.trim()).filter(Boolean);
  const pages = pagesFrom(fd, MAX_PAGES.basic_search);
  if (!name) return { error: "Give the list a name.", values };
  if (!keywords && !title && !seniority.length && !locations.length && !industries.length) {
    return { error: "Add at least one search filter.", values };
  }
  if (!pages) return { error: `Pages must be a whole number from 1 to ${MAX_PAGES.basic_search}.`, values };
  if (locations.length > 5 || industries.length > 5) {
    return { error: "Use at most 5 locations and 5 industries.", values };
  }
  const accounts = await usableAccounts(user);
  const account = accounts.find((a) => a.id === str(fd, "accountId"));
  if (!account?.unipileAccountId) return { error: "Choose a connected LinkedIn account.", values };

  // Turn typed names into LinkedIn ids.
  const resolve = async (type: "LOCATION" | "INDUSTRY", names: string[]) => {
    const ids: string[] = [];
    const matched: string[] = [];
    for (const n of names) {
      const hit = await lookupSearchParameter({ unipileAccountId: account.unipileAccountId!, type, keywords: n });
      if (!hit) throw new Error(`LinkedIn has no ${type === "LOCATION" ? "location" : "industry"} matching "${n}".`);
      ids.push(hit.id);
      matched.push(hit.title);
    }
    return { ids, matched };
  };
  let loc, ind;
  try {
    loc = await resolve("LOCATION", locations);
    ind = await resolve("INDUSTRY", industries);
  } catch (e) {
    const msg = e instanceof Error && e.message.startsWith("LinkedIn has no") ? e.message : "Could not look up the filters on LinkedIn. Try again.";
    if (!(e instanceof Error && e.message.startsWith("LinkedIn has no"))) console.error(e);
    return { error: msg, values };
  }

  const titleQuery = [title, ...seniority.map((s) => SENIORITY_TITLES[s])]
    .filter(Boolean)
    .map((t) => (seniority.length + (title ? 1 : 0) > 1 ? `(${t})` : t))
    .join(" OR ");

  const id = await startSearchList({
    userId: user.id,
    name,
    source: "basic_search",
    accountId: account.id,
    params: {
      api: "classic",
      category: "people",
      ...(keywords ? { keywords } : {}),
      ...(loc.ids.length ? { location: loc.ids } : {}),
      ...(ind.ids.length ? { industry: ind.ids } : {}),
      ...(titleQuery ? { advanced_keywords: { title: titleQuery } } : {}),
      display: {
        ...(keywords ? { Keywords: keywords } : {}),
        ...(title ? { Title: title } : {}),
        ...(seniority.length ? { Seniority: seniority.join(", ") } : {}),
        ...(loc.matched.length ? { Locations: loc.matched.join("; ") } : {}),
        ...(ind.matched.length ? { Industries: ind.matched.join("; ") } : {}),
      },
    },
    pages,
  });
  redirect(`/lead-sources/${id}`);
}

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 10_000;

async function readCsv(file: File) {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy" });
  return { rows: parsed.data, headers: (parsed.meta.fields ?? []).filter((h) => h.trim()) };
}

export type CsvPreview = {
  error?: string;
  headers?: string[];
  sample?: Record<string, string>[];
  rowCount?: number;
  mapping?: CsvMapping;
};

/** Reads a CSV's header and first rows so the person can check how columns are matched. */
export async function previewCsv(fd: FormData): Promise<CsvPreview> {
  await requireUser();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_CSV_BYTES) return { error: "The file is larger than 5 MB. Split it and import the parts." };
  const { rows, headers } = await readCsv(file);
  if (!headers.length) return { error: "The file has no header row." };
  if (rows.length > MAX_CSV_ROWS) return { error: `The file has ${rows.length.toLocaleString()} rows. The limit is ${MAX_CSV_ROWS.toLocaleString()} per import.` };
  const sample = rows.slice(0, 3).map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? "").slice(0, 80)])));
  return { headers: headers.slice(0, 100), sample, rowCount: rows.length, mapping: mapCsvHeaders(headers) };
}

export async function importCsv(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = valuesOf(fd);
  const name = str(fd, "name");
  const file = fd.get("file");
  if (!name) return { error: "Give the list a name.", values };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file.", values };
  if (file.size > MAX_CSV_BYTES) return { error: "The file is larger than 5 MB. Split it and import the parts.", values };

  const { rows, headers } = await readCsv(file);
  const parsed = { data: rows };
  if (!headers.length) return { error: "The file has no header row.", values };
  if (parsed.data.length > MAX_CSV_ROWS) {
    return { error: `The file has ${parsed.data.length.toLocaleString()} rows. The limit is ${MAX_CSV_ROWS.toLocaleString()} per import.`, values };
  }
  // A mapping chosen in the column chooser wins; otherwise match columns by name.
  let mapping: CsvMapping = mapCsvHeaders(headers);
  const chosen = str(fd, "mapping");
  if (chosen) {
    try {
      const raw = JSON.parse(chosen) as Record<string, string>;
      const allowed = new Set(CSV_FIELDS.map((f) => f.key as string));
      mapping = Object.fromEntries(Object.entries(raw).filter(([k, v]) => allowed.has(k) && typeof v === "string" && headers.includes(v))) as CsvMapping;
    } catch (e) {
      console.error("[csv] could not read the column choices:", e);
      return { error: "The column choices could not be read. Choose the file again.", values };
    }
  }
  if (!mapping.profileUrl && !(mapping.firstName || mapping.fullName)) {
    return {
      error: chosen
        ? "Choose a column for the LinkedIn profile URL, or for the name."
        : `Could not find a LinkedIn URL column or a name column. Columns found: ${headers.slice(0, 12).join(", ")}.`,
      values,
    };
  }

  const leads: LeadInput[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const lead = leadFromCsvRow(row, mapping);
    if (lead) leads.push(lead);
    else skipped += 1;
  }
  if (!leads.length) {
    return { error: "No usable rows. Each row needs a LinkedIn profile URL, or a first name and a company.", values };
  }

  const [list] = await db
    .insert(schema.leadLists)
    .values({
      name,
      source: "csv",
      createdByUserId: user.id,
      status: "running",
      params: { fileName: file.name, rows: parsed.data.length, mapping },
    })
    .returning();
  let suppressed = 0;
  const added = await insertLeads(list.id, leads, (n) => (suppressed = n));
  await db
    .update(schema.leadLists)
    .set({
      status: "ready",
      leadCount: added,
      params: { fileName: file.name, rows: parsed.data.length, mapping, imported: added, duplicates: leads.length - added - suppressed, skipped, suppressed },
      updatedAt: new Date(),
    })
    .where(eq(schema.leadLists.id, list.id));
  redirect(`/lead-sources/${list.id}`);
}

async function loadManageable(id: string) {
  const user = await requireUser();
  const [list] = await db.select().from(schema.leadLists).where(eq(schema.leadLists.id, id));
  if (!list || !canManageList(user, list)) return null;
  return list;
}

export async function cancelImport(fd: FormData) {
  const list = await loadManageable(str(fd, "id"));
  if (!list || !["queued", "running", "waiting"].includes(list.status)) return;
  await db
    .update(schema.leadLists)
    .set({ status: "cancelled", jobToken: null, updatedAt: new Date() })
    .where(eq(schema.leadLists.id, list.id));
  revalidatePath(`/lead-sources/${list.id}`);
}

export async function resumeImport(fd: FormData) {
  const list = await loadManageable(str(fd, "id"));
  if (!list || list.source === "csv" || !["failed", "cancelled"].includes(list.status)) return;
  await db.update(schema.leadLists).set({ error: null }).where(eq(schema.leadLists.id, list.id));
  await scheduleNextPage(list.id, 0, "queued");
  revalidatePath(`/lead-sources/${list.id}`);
}

export async function deleteList(fd: FormData) {
  const list = await loadManageable(str(fd, "id"));
  if (!list) return;
  await db.delete(schema.leadLists).where(eq(schema.leadLists.id, list.id));
  revalidatePath("/lead-sources");
  redirect("/lead-sources");
}
