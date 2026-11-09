import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { QUEUES } from "../src/lib/queue";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();

  // Install or upgrade the job queue's own tables (schema "pgboss") and create our queues.
  const boss = new PgBoss({ connectionString: url, supervise: false, schedule: false, registerInstance: false });
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, { retryLimit: 3, retryDelay: 60, retryBackoff: true });
    }
  }
  await boss.stop({ graceful: false });
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
