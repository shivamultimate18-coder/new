import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ConfirmButton } from "@/components/confirm-button";
import { ago } from "@/components/list-status";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { STARTER_PACKS } from "@/lib/voice/packs";
import { applyPack, deleteStyle } from "../../actions";
import { Playground } from "./playground";
import { RulesForm } from "./rules-form";

export const instant = false;
export const metadata: Metadata = { title: "Writing style" };

const TABS = [
  { id: "rules", label: "Rules" },
  { id: "playground", label: "Playground" },
  { id: "activity", label: "Activity" },
] as const;

const STEP_LABEL: Record<string, string> = { opener: "Opener", follow_up_1: "Follow-up 1", last_note: "Last note" };

export default async function StylePage({ params, searchParams }: PageProps<"/voice/styles/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "rules";

  const [style] = await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, id));
  if (!style) notFound();
  const products = await db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products)
    .orderBy(asc(schema.products.name));
  // Packs and learned rules change the rules from outside the form; remount it when they do.
  const [lastExternal] = await db
    .select({ id: schema.styleEvents.id })
    .from(schema.styleEvents)
    .where(and(eq(schema.styleEvents.styleId, id), inArray(schema.styleEvents.type, ["PACK_APPLIED", "RULES_LEARNED"])))
    .orderBy(desc(schema.styleEvents.at))
    .limit(1);
  const productName = products.find((p) => p.id === style.defaultProductId)?.name;
  const canDelete = user.role === "admin" || style.createdByUserId === user.id;

  return (
    <div className="max-w-4xl">
      <Link href="/voice" className="text-sm text-muted hover:text-ink">← Voice</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{style.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {style.rules.do.length} do · {style.rules.dont.length} don&apos;t{productName ? ` · usually selling ${productName}` : ""}
          </p>
        </div>
        {canDelete && (
          <form action={deleteStyle}>
            <input type="hidden" name="id" value={style.id} />
            <ConfirmButton message={`Delete "${style.name}"?`} className="btn btn-danger">Delete</ConfirmButton>
          </form>
        )}
      </div>

      <nav className="mt-5 flex gap-1 border-b border-line" aria-label="Style sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/voice/styles/${style.id}${t.id === "rules" ? "" : `?tab=${t.id}`}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "rules" && (
          <div className="space-y-6">
            <RulesForm key={lastExternal?.id ?? "initial"} style={style} products={products} />
            <section className="card p-5">
              <h2 className="font-medium">Starter packs</h2>
              <p className="mt-1 text-sm text-muted">Adds a pack&apos;s rules to this style. Edit or remove any of them afterwards.</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {STARTER_PACKS.map((p) => (
                  <li key={p.id} className="flex flex-col rounded-lg border border-line p-3">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="mt-0.5 flex-1 text-xs text-muted">{p.summary}</span>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted">See the {p.rules.do.length + p.rules.dont.length} rules</summary>
                      <ul className="mt-1 space-y-1">
                        {p.rules.do.map((r) => <li key={r}>DO {r}</li>)}
                        {p.rules.dont.map((r) => <li key={r}>DON&apos;T {r}</li>)}
                      </ul>
                    </details>
                    <form action={applyPack} className="mt-3">
                      <input type="hidden" name="id" value={style.id} />
                      <input type="hidden" name="pack" value={p.id} />
                      <button type="submit" className="btn btn-secondary">Add these rules</button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {tab === "playground" && <PlaygroundTab styleId={style.id} products={products} defaultProductId={style.defaultProductId} />}

        {tab === "activity" && <ActivityTab styleId={style.id} />}
      </div>
    </div>
  );
}

async function PlaygroundTab(props: { styleId: string; products: { id: string; name: string }[]; defaultProductId: string | null }) {
  const runs = await db
    .select()
    .from(schema.playgroundRuns)
    .where(eq(schema.playgroundRuns.styleId, props.styleId))
    .orderBy(desc(schema.playgroundRuns.createdAt))
    .limit(10);
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        Draft a full sequence with this style, as a real campaign would. Nothing is sent from here.
      </p>
      <Playground {...props} />
      {runs.length > 0 && (
        <section>
          <h2 className="font-medium">Recent drafts</h2>
          <ul className="mt-3 space-y-3">
            {runs.map((r) => (
              <li key={r.id} className="card p-4 text-sm">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{[r.prospect.firstName, r.prospect.lastName].filter(Boolean).join(" ")}</span>
                    <span className="text-muted"> · {[r.prospect.title, r.prospect.company].filter(Boolean).join(", ")} · {ago(r.createdAt)}</span>
                    {r.output.warnings.length > 0 && <span className="ml-2 text-amber-700">{r.output.warnings.length} rule warning(s)</span>}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {r.output.messages.map((m) => (
                      <div key={m.step}>
                        <div className="text-xs font-medium text-muted">{STEP_LABEL[m.step]}</div>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Created",
  PACK_APPLIED: "Pack applied",
  RULES_ADDED: "Rules added",
  RULES_REMOVED: "Rules removed",
  RULES_LEARNED: "Learned",
  RENAMED: "Renamed",
};

async function ActivityTab({ styleId }: { styleId: string }) {
  const events = await db
    .select({ e: schema.styleEvents, who: schema.users.name })
    .from(schema.styleEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.styleEvents.userId))
    .where(eq(schema.styleEvents.styleId, styleId))
    .orderBy(desc(schema.styleEvents.at))
    .limit(100);
  return (
    <ul className="card divide-y divide-line">
      {events.map(({ e, who }) => (
        <li key={e.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:gap-4">
          <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{EVENT_LABEL[e.type] ?? e.type}</span>
          <span className="flex-1">{e.description}</span>
          <span className="shrink-0 text-xs text-muted">{who ?? "Someone"} · {ago(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}
