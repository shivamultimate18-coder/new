"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { keepFieldsOnSubmit } from "@/components/use-keep-form";
import type { RuleSet } from "@/db/schema";
import { addLearnedRules, learnFromFeedback, runPlayground, searchLeads } from "../../actions";
import type { LeadOption } from "../../actions";

const STEP_LABEL: Record<string, string> = { opener: "Opener", follow_up_1: "Follow-up 1", last_note: "Last note" };

function LeadPicker({ onPick }: { onPick: (l: LeadOption | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [picked, setPicked] = useState<LeadOption | null>(null);
  useEffect(() => {
    if (picked || q.trim().length < 2) return;
    const t = setTimeout(async () => setResults(await searchLeads(q)), 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  if (picked) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
        <span className="font-medium">{picked.label}</span>
        <span className="text-muted">{picked.detail}</span>
        <button type="button" className="ml-auto text-brand hover:underline" onClick={() => { setPicked(null); onPick(null); setQ(""); setResults([]); }}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search imported leads by name, company or title"
        className="input"
        aria-label="Search leads"
      />
      {q.trim().length >= 2 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface shadow-sm">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matching leads.</li>
          ) : (
            results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-canvas"
                  onClick={() => { setPicked(r); onPick(r); }}
                >
                  <span className="font-medium">{r.label}</span> <span className="text-muted">{r.detail}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function RuleProposals({ styleId, rules, onDone }: { styleId: string; rules: RuleSet; onDone: () => void }) {
  const all = [...rules.do.map((r) => ({ kind: "do" as const, r })), ...rules.dont.map((r) => ({ kind: "dont" as const, r }))];
  const [selected, setSelected] = useState(() => new Set(all.map((_, i) => i)));
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  if (!all.length) {
    return <p className="text-sm text-muted">The existing rules already cover this feedback. Nothing new to add.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Proposed rules</p>
      <ul className="space-y-2">
        {all.map((x, i) => (
          <li key={i}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(i)}
                onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              />
              <span>
                <span className={`mr-1.5 rounded px-1.5 py-0.5 text-xs font-medium ${x.kind === "do" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                  {x.kind === "do" ? "DO" : "DON'T"}
                </span>
                {x.r}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={saving || selected.size === 0}
        onClick={() =>
          start(async () => {
            const pick = all.filter((_, i) => selected.has(i));
            const r = await addLearnedRules(styleId, {
              do: pick.filter((x) => x.kind === "do").map((x) => x.r),
              dont: pick.filter((x) => x.kind === "dont").map((x) => x.r),
            });
            if (r.error) setError(r.error);
            else onDone();
          })
        }
      >
        {saving ? "Adding…" : `Add ${selected.size} rule${selected.size === 1 ? "" : "s"} to this style`}
      </button>
    </div>
  );
}

type Run = NonNullable<NonNullable<Awaited<ReturnType<typeof runPlayground>>>["run"]>;

/** One draft with its feedback boxes. Keyed by run id, so a new draft starts clean. */
function DraftView({ run, styleId }: { run: Run; styleId: string }) {
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<RuleSet | null>(null);
  const [learnError, setLearnError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [learning, startLearn] = useTransition();
  return (
    <section className="space-y-4" aria-label="Draft">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Draft for {run.prospectName}</h2>
        {run.model === "mock" && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Mock draft (AI_MOCK=1)</span>}
      </div>
      <p className="text-sm text-muted">Angle: {run.output.angle}</p>
      {run.output.warnings.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">This draft still breaks a message rule after one rewrite:</p>
          <ul className="mt-1 list-disc pl-5">{run.output.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {run.output.messages.map((m) => (
        <div key={m.step} className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{STEP_LABEL[m.step]}</span>
            <span className="text-xs text-muted">{m.body.split(/\s+/).filter(Boolean).length} words</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
          <label className="mt-3 block text-xs font-medium text-muted">
            Feedback on this message
            <textarea
              rows={2}
              value={feedback[m.step] ?? ""}
              onChange={(e) => setFeedback((f) => ({ ...f, [m.step]: e.target.value }))}
              placeholder="e.g. too long, sounds salesy, the question is vague"
              className="input mt-1 text-sm font-normal text-ink"
            />
          </label>
        </div>
      ))}
      <div className="card space-y-3 p-4">
        <p className="text-sm text-muted">Write feedback on any message, then turn it into rules. You choose which rules to keep.</p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={learning || !Object.values(feedback).some((v) => v.trim())}
          onClick={() =>
            startLearn(async () => {
              setLearnError(null);
              setAdded(false);
              const r = await learnFromFeedback(run.id, Object.entries(feedback).map(([step, f]) => ({ step, feedback: f })));
              if (r.error) setLearnError(r.error);
              else setProposals(r.rules ?? null);
            })
          }
        >
          {learning ? "Thinking…" : "Turn feedback into rules"}
        </button>
        {learnError && <p role="alert" className="text-sm text-red-700">{learnError}</p>}
        {added ? (
          <p role="status" className="text-sm text-emerald-700">Rules added. Draft again to see the difference.</p>
        ) : (
          proposals && <RuleProposals styleId={styleId} rules={proposals} onDone={() => { setAdded(true); setProposals(null); }} />
        )}
      </div>
    </section>
  );
}

export function Playground(props: {
  styleId: string;
  products: { id: string; name: string }[];
  defaultProductId: string | null;
}) {
  const [state, action, pending] = useActionState(runPlayground, null);
  const [mode, setMode] = useState<"lead" | "sample">("lead");
  const [lead, setLead] = useState<LeadOption | null>(null);

  if (!props.products.length) {
    return <div className="card p-6 text-sm text-muted">Add a product on the Voice page first; drafts need something to sell.</div>;
  }

  return (
    <div className="space-y-6">
      <form onSubmit={keepFieldsOnSubmit(action)} className="card space-y-4 p-5">
        <input type="hidden" name="styleId" value={props.styleId} />
        <input type="hidden" name="leadId" value={mode === "lead" ? (lead?.id ?? "") : ""} />
        <label className="block text-sm font-medium">
          Product
          <select name="productId" defaultValue={props.defaultProductId ?? props.products[0].id} className="input mt-1">
            {props.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="text-sm font-medium">Prospect</legend>
          <div className="mt-2 flex gap-2" role="radiogroup">
            {(["lead", "sample"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`btn ${mode === m ? "btn-primary" : "btn-secondary"}`}
              >
                {m === "lead" ? "An imported lead" : "A made-up prospect"}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {mode === "lead" ? (
              <LeadPicker onPick={setLead} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="firstName" placeholder="First name *" className="input" />
                <input name="lastName" placeholder="Last name" className="input" />
                <input name="title" placeholder="Job title" className="input" />
                <input name="company" placeholder="Company" className="input" />
                <input name="headline" placeholder="LinkedIn headline" className="input sm:col-span-2" />
                <textarea name="notes" rows={2} placeholder="Anything else you know about them" className="input sm:col-span-2" />
              </div>
            )}
          </div>
        </fieldset>
        {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending || (mode === "lead" && !lead)} className="btn btn-primary">
          {pending ? "Drafting… (about 10 to 30 seconds)" : "Draft messages"}
        </button>
      </form>

      {state?.run && <DraftView key={state.run.id} run={state.run} styleId={props.styleId} />}
    </div>
  );
}
