// Usage: npm run user:create -- <email> "<name>" [admin|member]
// Password comes from USER_PASSWORD, or a random one is generated and printed once.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../src/db/schema";

async function main() {
  const [email, name, role = "member"] = process.argv.slice(2);
  if (!email || !name || (role !== "admin" && role !== "member")) {
    throw new Error('Usage: npm run user:create -- <email> "<name>" [admin|member]');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const generated = !process.env.USER_PASSWORD;
  const password = process.env.USER_PASSWORD ?? randomBytes(12).toString("base64url");
  if (password.length < 12) throw new Error("Password must be at least 12 characters");

  const client = postgres(url, { max: 1 });
  await drizzle(client)
    .insert(users)
    .values({ email: email.toLowerCase().trim(), name, role, passwordHash: await bcrypt.hash(password, 12) });
  await client.end();
  console.log(`Created ${role} ${email}`);
  if (generated) console.log(`Password (shown once): ${password}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
