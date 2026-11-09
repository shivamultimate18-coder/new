import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { createProduct, createStyle } from "./actions";

export const instant = false;
export const metadata: Metadata = { title: "Voice" };

export default async function VoicePage() {
  await requireUser();
  const [products, styles] = await Promise.all([
    db.select().from(schema.products).orderBy(asc(schema.products.name)),
    db.select().from(schema.writingStyles).orderBy(asc(schema.writingStyles.name)),
  ]);
  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold">Voice</h1>
      <p className="mt-1 text-sm text-muted">
        What you sell and how your messages should sound. Every drafted message uses one product and one writing style.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Products and services</h2>
            <form action={createProduct}>
              <button type="submit" className="btn btn-secondary">New product</button>
            </form>
          </div>
          <p className="mt-1 text-sm text-muted">Facts, proof, pricing and offers the writer may use.</p>
          {products.length === 0 ? (
            <p className="mt-6 text-sm text-muted">No products yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {products.map((p) => {
                const missing = [p.description, p.valueProps, p.painPoints, p.proofPoints].filter((v) => !v.trim()).length;
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/voice/products/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.name}</Link>
                    <span className={`shrink-0 text-xs ${missing ? "text-amber-700" : "text-muted"}`}>
                      {missing ? `${missing} required field${missing === 1 ? "" : "s"} empty` : `Updated ${ago(p.updatedAt)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Writing styles</h2>
            <form action={createStyle}>
              <button type="submit" className="btn btn-secondary">New style</button>
            </form>
          </div>
          <p className="mt-1 text-sm text-muted">DO and DON&apos;T rules for tone and length. Test them in the playground.</p>
          {styles.length === 0 ? (
            <p className="mt-6 text-sm text-muted">No writing styles yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {styles.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/voice/styles/${s.id}`} className="min-w-0 truncate font-medium hover:underline">{s.name}</Link>
                  <span className="shrink-0 text-xs text-muted">
                    {s.rules.do.length} do · {s.rules.dont.length} don&apos;t
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
