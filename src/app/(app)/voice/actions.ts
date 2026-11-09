"use server";

import { and, desc, eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { DraftSequence, RuleSet } from "@/db/schema";
import { friendlyAiError } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import { draftIcp, draftSequence, proposeRules } from "@/lib/voice/compose";
import type { Prospect } from "@/lib/voice/compose";
import { STARTER_PACKS } from "@/lib/voice/packs";

const str = (fd: FormData, k: string, max = 5000) => String(fd.get(k) ?? "").trim().slice(0, max);
const lines = (text: string) =>
  [...new Set(text.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean))].slice(0, 40);
const canDelete = (u: CurrentUser, row: { createdByUserId: string | null }) =>
  u.role === "admin" || row.createdByUserId === u.id;

async function logStyle(styleId: string, userId: string, type: string, description: string) {
  await db.insert(schema.styleEvents).values({ styleId, userId, type, description: description.slice(0, 500) });
}

// ---------------------------------------------------------------------------
// Products

export async function createProduct() {
  const user = await requireUser();
  const [p] = await db
    .insert(schema.products)
    .values({ name: "New product", createdByUserId: user.id })
    .returning();
  redirect(`/voice/products/${p.id}`);
}

export type SaveState = { ok?: boolean; error?: string; at?: number } | null;

export async function saveProduct(_prev: SaveState, fd: FormData): Promise<SaveState> {
  await requireUser();
  const id = str(fd, "id");
  const name = str(fd, "name", 200);
  if (!name) return { error: "The product needs a name." };
  const required: [string, string][] = [
    ["description", "Description"],
    ["valueProps", "Value propositions"],
    ["painPoints", "Pain points"],
    ["proofPoints", "Proof points"],
  ];
  const missing = required.filter(([k]) => !str(fd, k)).map(([, label]) => label);
  const bookingLink = str(fd, "bookingLink", 500);
  if (bookingLink && !/^https?:\/\//i.test(bookingLink)) return { error: "The booking link must start with https://" };
  await db
    .update(schema.products)
    .set({
      name,
      description: str(fd, "description"),
      icp: str(fd, "icp"),
      bookingLink,
      specifics: str(fd, "specifics"),
      competitors: str(fd, "competitors"),
      services: str(fd, "services"),
      price: str(fd, "price", 500),
      freeOffer: str(fd, "freeOffer", 500),
      valueProps: str(fd, "valueProps"),
      painPoints: str(fd, "painPoints"),
      proofPoints: str(fd, "proofPoints"),
      pitchRules: { do: lines(str(fd, "pitchDo")), dont: lines(str(fd, "pitchDont")) },
      updatedAt: new Date(),
    })
    .where(eq(schema.products.id, id));
  revalidatePath("/voice");
  // Saved even when incomplete, so work is not lost; drafting needs the required fields.
  if (missing.length) return { ok: true, at: Date.now(), error: `Saved. Still needed before drafting: ${missing.join(", ")}.` };
  return { ok: true, at: Date.now() };
}

export async function suggestIcp(productId: string): Promise<{ icp?: string; error?: string }> {
  const user = await requireUser();
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
  if (!p) return { error: "Product not found." };
  if (!p.description.trim()) return { error: "Save a description first; the profile is drafted from it." };
  try {
    return { icp: await draftIcp(p, user.id) };
  } catch (e) {
    console.error(e);
    return { error: friendlyAiError(e) };
  }
}

export async function deleteProduct(fd: FormData) {
  const user = await requireUser();
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, str(fd, "id")));
  if (!p || !canDelete(user, p)) return;
  await db.delete(schema.products).where(eq(schema.products.id, p.id));
  revalidatePath("/voice");
  redirect("/voice");
}

// ---------------------------------------------------------------------------
// Writing styles

export async function createStyle() {
  const user = await requireUser();
  const [s] = await db
    .insert(schema.writingStyles)
    .values({ name: "New writing style", createdByUserId: user.id })
    .returning();
  await logStyle(s.id, user.id, "CREATED", "Style created.");
  redirect(`/voice/styles/${s.id}`);
}

export async function saveStyle(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const user = await requireUser();
  const id = str(fd, "id");
  const name = str(fd, "name", 200);
  if (!name) return { error: "The style needs a name." };
  const [style] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, id));
  if (!style) return { error: "Style not found." };
  const next: RuleSet = { do: lines(str(fd, "do", 20000)), dont: lines(str(fd, "dont", 20000)) };
  const productId = str(fd, "defaultProductId") || null;

  await db
    .update(schema.writingStyles)
    .set({ name, rules: next, defaultProductId: productId, updatedAt: new Date() })
    .where(eq(schema.writingStyles.id, id));

  const added = [...next.do.filter((r) => !style.rules.do.includes(r)), ...next.dont.filter((r) => !style.rules.dont.includes(r))];
  const removed = [...style.rules.do.filter((r) => !next.do.includes(r)), ...style.rules.dont.filter((r) => !next.dont.includes(r))];
  if (added.length) await logStyle(id, user.id, "RULES_ADDED", `Added: ${added.join(" · ")}`);
  if (removed.length) await logStyle(id, user.id, "RULES_REMOVED", `Removed: ${removed.join(" · ")}`);
  if (name !== style.name) await logStyle(id, user.id, "RENAMED", `Renamed from "${style.name}" to "${name}".`);
  revalidatePath(`/voice/styles/${id}`);
  revalidatePath("/voice");
  return { ok: true, at: Date.now() };
}

export async function applyPack(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  const pack = STARTER_PACKS.find((p) => p.id === str(fd, "pack"));
  const [style] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, id));
  if (!style || !pack) return;
  const merged: RuleSet = {
    do: [...new Set([...style.rules.do, ...pack.rules.do])],
    dont: [...new Set([...style.rules.dont, ...pack.rules.dont])],
  };
  await db.update(schema.writingStyles).set({ rules: merged, updatedAt: new Date() }).where(eq(schema.writingStyles.id, id));
  await logStyle(id, user.id, "PACK_APPLIED", `Applied the "${pack.name}" starter pack.`);
  revalidatePath(`/voice/styles/${id}`);
}

export async function deleteStyle(fd: FormData) {
  const user = await requireUser();
  const [s] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, str(fd, "id")));
  if (!s || !canDelete(user, s)) return;
  await db.delete(schema.writingStyles).where(eq(schema.writingStyles.id, s.id));
  revalidatePath("/voice");
  redirect("/voice");
}

// ---------------------------------------------------------------------------
// Playground

export type LeadOption = { id: string; label: string; detail: string };

export async function searchLeads(q: string): Promise<LeadOption[]> {
  await requireUser();
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = await db
    .select()
    .from(schema.leads)
    .where(
      or(
        ilike(schema.leads.firstName, like),
        ilike(schema.leads.lastName, like),
        ilike(schema.leads.company, like),
        ilike(schema.leads.title, like),
      ),
    )
    .orderBy(desc(schema.leads.createdAt))
    .limit(10);
  return rows.map((l) => ({
    id: l.id,
    label: `${l.firstName} ${l.lastName}`.trim(),
    detail: [l.title, l.company].filter(Boolean).join(" · ") || l.headline || "",
  }));
}

export type RunState = { error?: string; run?: { id: string; prospectName: string; output: DraftSequence; model: string } } | null;

export async function runPlayground(_prev: RunState, fd: FormData): Promise<RunState> {
  const user = await requireUser();
  const styleId = str(fd, "styleId");
  const productId = str(fd, "productId");
  const leadId = str(fd, "leadId");
  const [style] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, styleId));
  const [product] = productId ? await db.select().from(schema.products).where(eq(schema.products.id, productId)) : [];
  if (!style) return { error: "Style not found." };
  if (!product) return { error: "Choose a product." };
  const missing = [
    ["description", product.description],
    ["value propositions", product.valueProps],
    ["pain points", product.painPoints],
    ["proof points", product.proofPoints],
  ].filter(([, v]) => !v.trim());
  if (missing.length) return { error: `Fill in the product's ${missing.map(([k]) => k).join(", ")} first.` };

  let prospect: Prospect;
  let linkedLead: string | null = null;
  if (leadId) {
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    if (!lead) return { error: "That lead no longer exists." };
    linkedLead = lead.id;
    prospect = {
      firstName: lead.firstName,
      lastName: lead.lastName,
      title: lead.title ?? undefined,
      company: lead.company ?? undefined,
      headline: lead.headline ?? undefined,
      location: lead.location ?? undefined,
      industry: lead.industry ?? undefined,
    };
  } else {
    prospect = {
      firstName: str(fd, "firstName", 80),
      lastName: str(fd, "lastName", 80),
      title: str(fd, "title", 200),
      company: str(fd, "company", 200),
      headline: str(fd, "headline", 300),
      notes: str(fd, "notes", 1000),
    };
    if (!prospect.firstName) return { error: "Pick a lead, or enter at least a first name for a sample prospect." };
  }

  try {
    const { draft, model } = await draftSequence({ style: style.rules, product, prospect, userId: user.id });
    const clean = Object.fromEntries(Object.entries(prospect).filter(([, v]) => v)) as Record<string, string>;
    const [run] = await db
      .insert(schema.playgroundRuns)
      .values({ styleId, productId: product.id, leadId: linkedLead, prospect: clean, output: draft, model, createdByUserId: user.id })
      .returning();
    revalidatePath(`/voice/styles/${styleId}`);
    return { run: { id: run.id, prospectName: `${prospect.firstName} ${prospect.lastName ?? ""}`.trim(), output: draft, model } };
  } catch (e) {
    console.error(e);
    return { error: friendlyAiError(e) };
  }
}

export async function learnFromFeedback(
  runId: string,
  feedback: { step: string; feedback: string }[],
): Promise<{ rules?: RuleSet; error?: string }> {
  const user = await requireUser();
  const [run] = await db.select().from(schema.playgroundRuns).where(eq(schema.playgroundRuns.id, runId));
  if (!run) return { error: "Run not found." };
  const [style] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, run.styleId));
  if (!style) return { error: "Style not found." };
  const items = feedback
    .map((f) => ({
      step: f.step,
      feedback: f.feedback.trim().slice(0, 1000),
      message: run.output.messages.find((m) => m.step === f.step)?.body ?? "",
    }))
    .filter((f) => f.feedback && f.message);
  if (!items.length) return { error: "Write feedback on at least one message." };
  try {
    return { rules: await proposeRules({ style: style.rules, feedback: items, userId: user.id }) };
  } catch (e) {
    console.error(e);
    return { error: friendlyAiError(e) };
  }
}

export async function addLearnedRules(styleId: string, rules: RuleSet): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  const [style] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, styleId));
  if (!style) return { error: "Style not found." };
  const clean = (xs: string[]) => xs.map((x) => x.trim().slice(0, 300)).filter(Boolean).slice(0, 5);
  const add = { do: clean(rules.do), dont: clean(rules.dont) };
  if (!add.do.length && !add.dont.length) return { error: "Select at least one rule." };
  await db
    .update(schema.writingStyles)
    .set({
      rules: { do: [...new Set([...style.rules.do, ...add.do])], dont: [...new Set([...style.rules.dont, ...add.dont])] },
      updatedAt: new Date(),
    })
    .where(and(eq(schema.writingStyles.id, styleId)));
  await logStyle(
    styleId,
    user.id,
    "RULES_LEARNED",
    `Learned from playground feedback: ${[...add.do.map((r) => `DO ${r}`), ...add.dont.map((r) => `DON'T ${r}`)].join(" · ")}`,
  );
  revalidatePath(`/voice/styles/${styleId}`);
  return { ok: true };
}
