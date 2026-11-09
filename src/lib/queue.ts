import { PgBoss } from "pg-boss";
import { env } from "./env";

/** Job queue on Postgres (plan section 5). The worker process (scripts/worker.ts) runs the jobs. */

export const QUEUES = {
  importPage: "lead-import-page",
  draft: "draft-messages",
  classify: "classify-intent",
} as const;

export type ClassifyJob = { conversationId: string };

/** Debounced per conversation: a burst of messages (or a sync) is classified once, after it ends. */
export async function enqueueClassify(conversationId: string) {
  const boss = await getBoss();
  await boss.sendDebounced(QUEUES.classify, { conversationId } satisfies ClassifyJob, null, 5, conversationId);
}

export type DraftJob = { leadStateId: string };

export async function enqueueDraft(leadStateId: string) {
  const boss = await getBoss();
  await boss.send(QUEUES.draft, { leadStateId } satisfies DraftJob);
}

export type ImportPageJob = { listId: string; token: string };

const g = globalThis as unknown as { boss?: Promise<PgBoss> };

/** A sending-only instance for the web app: no maintenance or scheduling, which the worker does. */
export function getBoss(): Promise<PgBoss> {
  g.boss ??= (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      max: 3,
      supervise: false,
      schedule: false,
      migrate: false,
      registerInstance: false,
    });
    boss.on("error", (e) => console.error("pg-boss:", e));
    await boss.start();
    return boss;
  })().catch((e) => {
    g.boss = undefined;
    throw e;
  });
  return g.boss;
}

export async function ensureQueues(boss: PgBoss) {
  for (const name of Object.values(QUEUES)) {
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, { retryLimit: 3, retryDelay: 60, retryBackoff: true });
    }
  }
}

/**
 * Queues the next page of an import. The caller must already have stored `token` as the
 * list's job_token; the worker skips any job whose token no longer matches.
 */
export async function enqueueImportPage(job: ImportPageJob, delaySeconds = 0) {
  const boss = await getBoss();
  await boss.send(QUEUES.importPage, job, { startAfter: Math.max(0, Math.round(delaySeconds)) });
}
