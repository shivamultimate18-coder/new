import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// The connection pool survives dev hot reloads; the query builder is rebuilt with each
// module load so it always uses the current schema.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
let instance: Db | undefined;

function real(): Db {
  // Created on first use, so `next build` needs no database.
  globalForDb.pg ??= postgres(env.DATABASE_URL, { max: 10 });
  instance ??= drizzle(globalForDb.pg, { schema });
  return instance;
}

export const db = new Proxy({} as Db, {
  get(_t, prop) {
    const target = real();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
