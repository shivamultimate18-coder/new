// Background worker: lead imports (queue jobs) and the sending engine (a tick loop).
// Run with: npm run worker
import { PgBoss } from "pg-boss";
import { generateDrafts } from "../src/lib/drafting";
import { tick } from "../src/lib/engine/engine";
import { classifyConversation } from "../src/lib/inbox";
import { runImportPage } from "../src/lib/imports";
import { QUEUES, ensureQueues } from "../src/lib/queue";
import type { ClassifyJob, DraftJob, ImportPageJob } from "../src/lib/queue";

const TICK_MS = process.env.UNIPILE_MOCK === "1" ? 3_000 : 60_000;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const boss = new PgBoss({ connectionString: url, instanceName: "worker" });
  boss.on("error", (e) => console.error("pg-boss:", e));
  await boss.start({ attempts: 5 });
  await ensureQueues(boss);

  await boss.work<ImportPageJob>(QUEUES.importPage, { localConcurrency: 4 }, async ([job]) => {
    const outcome = await runImportPage(job.data.listId, job.data.token);
    console.log(`[import] list=${job.data.listId} ${outcome}`);
    return { outcome };
  });

  // AI drafting after acceptance. Few at a time to stay inside Claude rate limits.
  await boss.work<DraftJob>(QUEUES.draft, { localConcurrency: 3 }, async ([job]) => {
    const outcome = await generateDrafts(job.data.leadStateId);
    console.log(`[draft] lead=${job.data.leadStateId} ${outcome}`);
    return { outcome };
  });

  // Inbox intent, re-scored when a prospect writes.
  await boss.work<ClassifyJob>(QUEUES.classify, { localConcurrency: 4 }, async ([job]) => {
    const outcome = await classifyConversation(job.data.conversationId);
    console.log(`[intent] conversation=${job.data.conversationId} ${outcome}`);
    return { outcome };
  });

  // Sending engine. Ticks never overlap: the next one is scheduled after this one ends,
  // and a database lock stops two workers from ticking at once.
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  const loop = async () => {
    try {
      const r = await tick();
      if (r.ran && r.results && (r.results.acted || r.results.error)) console.log(`[engine] ${JSON.stringify(r.results)}`);
    } catch (e) {
      console.error("[engine] tick failed:", e);
    }
    if (!stopping) timer = setTimeout(loop, TICK_MS);
  };
  timer = setTimeout(loop, 1_000);

  console.log(`Worker started. Engine tick every ${TICK_MS / 1000}s.`);
  const stop = async () => {
    console.log("Stopping worker…");
    stopping = true;
    clearTimeout(timer);
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
