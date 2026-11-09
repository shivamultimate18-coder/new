import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;
const globalForDb = globalThis as unknown as { db?: Db };

function real(): Db {
  // Created on first use (so `next build` needs no database) and reused across hot reloads.
  globalForDb.db ??= drizzle(postgres(env.DATABASE_URL, { max: 10 }), { schema });
  return globalForDb.db;
}

export const db = new Proxy({} as Db, {
  get(_t, prop) {
    const target = real();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
