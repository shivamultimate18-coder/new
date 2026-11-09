// Background worker: runs queued jobs (lead imports now; sending from Phase 5).
// Run with: npm run worker
import { PgBoss } from "pg-boss";
import { runImportPage } from "../src/lib/imports";
import { QUEUES, ensureQueues } from "../src/lib/queue";
import type { ImportPageJob } from "../src/lib/queue";

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

  console.log("Worker started.");
  const stop = async () => {
    console.log("Stopping worker…");
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
