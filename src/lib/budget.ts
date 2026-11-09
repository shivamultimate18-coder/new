import "server-only";
import { eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { AiOutputError, PRICES } from "./ai";

/** Thrown before a Claude call when the month's AI budget is used up. */
export class AiBudgetError extends AiOutputError {
  constructor() {
    super("This month's AI budget is used up, so drafting is paused. An admin can raise it under Settings > AI usage.");
  }
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(schema.appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

export const BUDGET_KEY = "ai.monthlyBudgetUsd";

export function startOfMonthUtc(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** USD estimate from stored token counts and list prices (cache writes at 1.25x input). */
export function costOf(model: string, t: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.input * 1.25) / 1_000_000;
}

export type UsageRow = { feature: string; model: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };

export async function usageSince(since: Date): Promise<UsageRow[]> {
  const rows = await db
    .select({
      feature: schema.aiUsage.feature,
      model: schema.aiUsage.model,
      calls: sql<number>`count(*)::int`,
      input: sql<number>`coalesce(sum(${schema.aiUsage.inputTokens}),0)::bigint`,
      output: sql<number>`coalesce(sum(${schema.aiUsage.outputTokens}),0)::bigint`,
      cacheRead: sql<number>`coalesce(sum(${schema.aiUsage.cacheReadTokens}),0)::bigint`,
      cacheWrite: sql<number>`coalesce(sum(${schema.aiUsage.cacheWriteTokens}),0)::bigint`,
    })
    .from(schema.aiUsage)
    .where(gte(schema.aiUsage.at, since))
    .groupBy(schema.aiUsage.feature, schema.aiUsage.model);
  return rows.map((r) => {
    const t = { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cacheRead), cacheWrite: Number(r.cacheWrite) };
    return { feature: r.feature, model: r.model, calls: r.calls, ...t, cost: costOf(r.model, t) };
  });
}

export async function budgetStatus() {
  const [budget, rows] = await Promise.all([getSetting<number>(BUDGET_KEY), usageSince(startOfMonthUtc())]);
  const spent = rows.reduce((n, r) => n + r.cost, 0);
  return { budget: budget && budget > 0 ? budget : null, spent, share: budget && budget > 0 ? spent / budget : null };
}

// Checked before every Claude call; cached briefly so busy workers do not query each time.
let cache: { at: number; over: boolean } | null = null;

export async function assertAiBudget() {
  if (!cache || Date.now() - cache.at > 30_000) {
    const s = await budgetStatus();
    cache = { at: Date.now(), over: s.budget !== null && s.spent >= s.budget };
  }
  if (cache.over) throw new AiBudgetError();
}

export function clearBudgetCache() {
  cache = null;
}
