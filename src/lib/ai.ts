import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/db";
import { env } from "./env";

/**
 * Models from plan section 4: Sonnet for drafting, Haiku for small, high-volume jobs.
 * Changing a model here changes it everywhere.
 */
export const MODELS = {
  drafting: "claude-sonnet-5-5",
  light: "claude-haiku-5-5",
} as const;

/** Approximate list prices in USD per million tokens, for the usage screen. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/**
 * On a safety decline, the API retries the request on a recommended fallback model.
 * Sonnet supports this; Haiku has no server-side fallback.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("The Claude API key is not set. Add ANTHROPIC_API_KEY to the server's .env, or set AI_MOCK=1 for testing.");
  }
}

/** A refusal or an output that could not be parsed: show the person a plain message. */
export class AiOutputError extends Error {}

const g = globalThis as unknown as { anthropic?: Anthropic };

export function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  g.anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  return g.anthropic;
}

export async function recordUsage(opts: {
  feature: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  userId?: string | null;
}) {
  await db.insert(schema.aiUsage).values({
    feature: opts.feature,
    model: opts.model,
    inputTokens: opts.usage.input_tokens,
    outputTokens: opts.usage.output_tokens,
    cacheReadTokens: opts.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: opts.usage.cache_creation_input_tokens ?? 0,
    userId: opts.userId ?? null,
  });
}

/** Turns SDK errors into messages a teammate can act on. */
export function friendlyAiError(e: unknown): string {
  if (e instanceof AiNotConfiguredError || e instanceof AiOutputError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The Claude API key does not have access to this model.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate limiting us right now. Wait a minute and try again.";
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit|billing|spend/i.test(e.message)) return "The Claude account is out of credit or over its spend limit.";
    return "Claude rejected the request. The details are in the server log.";
  }
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach Claude. Check the server's internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? "unknown"}). Try again.`;
  return "Something went wrong while drafting. Try again.";
}
