"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SequenceStep } from "@/db/schema";
import { LIMITS, MAX_MESSAGE_STEPS } from "@/lib/campaigns/limits";
import { PLAYBOOKS, defaultSteps } from "@/lib/campaigns/playbooks";
import { INVITE_NOTE_MAX, VARIABLES, unknownVariables } from "@/lib/campaigns/template";
import { saveCampaign } from "../../actions";
import type { CampaignPayload } from "../../actions";

type Option = { id: string; name: string; detail?: string };
type AccountOption = { id: string; name: string; status: string; enabled: boolean; hasSalesNav: boolean; dailyInviteLimit: number; usable: boolean };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-medium">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function stepTitle(i: number, s: SequenceStep, count: number) {
  if (s.type === "invite") return "Connection request";
  if (i === 1) return "Message 1 (opener)";
  if (i === count - 1) return `Message ${i} (last note)`;
  return `Message ${i} (follow-up)`;
}

function StepCard(props: {
  step: SequenceStep;
  index: number;
  count: number;
  locked: boolean;
  onChange: (s: SequenceStep) => void;
  onRemove?: () => void;
}) {
  const { step: s, index: i, locked } = props;
  const set = (patch: Partial<SequenceStep>) => props.onChange({ ...s, ...patch });
  const unknown = [...unknownVariables(s.template), ...unknownVariables(s.fallback)];
  const tooLong = s.type === "invite" && Math.max(s.template.length, s.fallback.length) > INVITE_NOTE_MAX;
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{stepTitle(i, s, props.count)}</span>
        {props.onRemove && !locked && (
          <button type="button" onClick={props.onRemove} className="text-sm text-red-700 hover:underline">
            Remove
          </button>
        )}
      </div>
      {i > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted">Wait</span>
          <button type="button" disabled={locked || s.waitDays <= 0} aria-label="Fewer days" onClick={() => set({ waitDays: s.waitDays - 1 })} className="btn btn-secondary px-2.5 py-1">−</button>
          <span className="w-16 text-center tabular-nums">{s.waitDays} day{s.waitDays === 1 ? "" : "s"}</span>
          <button type="button" disabled={locked || s.waitDays >= 30} aria-label="More days" onClick={() => set({ waitDays: s.waitDays + 1 })} className="btn btn-secondary px-2.5 py-1">+</button>
          <span className="text-muted">{i === 1 ? "after they accept" : "after the previous message, if no reply"}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Content">
        {(s.type === "invite"
          ? [
              ["blank", "No note (recommended)"],
              ["template", "Note from a template"],
            ]
          : [
              ["ai", "Drafted by AI for each lead"],
              ["template", "Same template for everyone"],
            ]
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={s.mode === mode}
            disabled={locked}
            onClick={() => set({ mode: mode as SequenceStep["mode"] })}
            className={`btn px-3 py-1.5 ${s.mode === mode ? "btn-primary" : "btn-secondary"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {s.type === "invite" && s.mode === "template" && (
        <p className="mt-2 text-xs text-amber-800">Notes are sent only from Sales Navigator accounts, and every sending account must have it.</p>
      )}
      {s.mode === "ai" && (
        <p className="mt-2 text-xs text-muted">Written from the lead&apos;s profile, the product and the writing style, then queued for review.</p>
      )}
      {s.mode === "template" && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium text-muted">
            Text
            <textarea
              rows={3}
              value={s.template}
              disabled={locked}
              onChange={(e) => set({ template: e.target.value })}
              className="input mt-1 text-sm font-normal text-ink"
              placeholder="Hi {first_name}, …"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(VARIABLES).map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={locked}
                onClick={() => set({ template: `${s.template}{${k}}` })}
                className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-canvas"
              >
                + {label}
              </button>
            ))}
          </div>
          <label className="block text-xs font-medium text-muted">
            If a variable is missing for a lead, send this instead
            <textarea
              rows={2}
              value={s.fallback}
              disabled={locked}
              onChange={(e) => set({ fallback: e.target.value })}
              className="input mt-1 text-sm font-normal text-ink"
              placeholder="Leave empty to skip that lead at this step"
            />
          </label>
          {unknown.length > 0 && <p className="text-xs text-red-700">Unknown variables: {unknown.map((u) => `{${u}}`).join(", ")}</p>}
          {s.type === "invite" && (
            <p className={`text-xs ${tooLong ? "text-red-700" : "text-muted"}`}>
              {s.template.length} / {INVITE_NOTE_MAX} characters
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function CampaignEditor(props: {
  id: string;
  status: string;
  initial: CampaignPayload;
  products: Option[];
  styles: Option[];
  lists: Option[];
  accounts: AccountOption[];
  timezones: string[];
}) {
  const router = useRouter();
  const [v, setV] = useState<CampaignPayload>(props.initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, start] = useTransition();
  const locked = props.status !== "draft";
  const set = (patch: Partial<CampaignPayload>) => {
    setSaved(false);
    setV((x) => ({ ...x, ...patch }));
  };
  const setStep = (i: number, s: SequenceStep) => set({ steps: v.steps.map((x, j) => (j === i ? s : x)) });
  const messageCount = v.steps.filter((s) => s.type === "message").length;
  const totalDays = v.steps.reduce((n, s) => n + s.waitDays, 0);
  const selectedAccounts = props.accounts.filter((a) => v.accountIds.includes(a.id));
  const lowestWarmup = selectedAccounts.length ? Math.min(...selectedAccounts.map((a) => a.dailyInviteLimit)) : null;

  const save = (thenView: boolean) =>
    start(async () => {
      setError(null);
      const r = await saveCampaign(props.id, v);
      if (r.error) setError(r.error);
      else if (thenView) router.push(`/campaigns/${props.id}`);
      else setSaved(true);
    });

  const choosePlaybook = (id: string) => {
    if (locked || id === v.playbook) return;
    const custom = v.steps.some((s) => s.mode === "template" && s.template.trim());
    if (custom && !window.confirm("Switching playbook rebuilds the sequence and removes your template text. Continue?")) return;
    set({ playbook: id, steps: defaultSteps(id) });
  };

  return (
    <div className="space-y-6">
      {locked && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This campaign has launched, so its lead list and sequence are fixed. To change them, duplicate the campaign.
        </p>
      )}

      <Section title="Basics">
        <label className="block text-sm font-medium">
          Campaign name
          <input value={v.name} onChange={(e) => set({ name: e.target.value })} className="input mt-1" placeholder="e.g. Austin paving owners, November" />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Lead list
            <select value={v.leadListId ?? ""} disabled={locked} onChange={(e) => set({ leadListId: e.target.value || null })} className="input mt-1">
              <option value="">Choose…</option>
              {props.lists.map((o) => <option key={o.id} value={o.id}>{o.name}{o.detail ? ` (${o.detail})` : ""}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Product
            <select value={v.productId ?? ""} onChange={(e) => set({ productId: e.target.value || null })} className="input mt-1">
              <option value="">Choose…</option>
              {props.products.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Writing style
            <select value={v.writingStyleId ?? ""} onChange={(e) => set({ writingStyleId: e.target.value || null })} className="input mt-1">
              <option value="">Choose…</option>
              {props.styles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          New lists are made in <Link href="/lead-sources" className="text-brand hover:underline">Lead Sources</Link>; products and styles in{" "}
          <Link href="/voice" className="text-brand hover:underline">Voice</Link>.
        </p>
      </Section>

      <Section title="Strategy" hint="A playbook sets the steps and tells the writer how to build the sequence. Switching rebuilds the steps.">
        <div className="grid gap-3 sm:grid-cols-2">
          {PLAYBOOKS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={locked}
              aria-pressed={v.playbook === p.id}
              onClick={() => choosePlaybook(p.id)}
              className={`rounded-lg border p-3 text-left text-sm ${v.playbook === p.id ? "border-brand bg-brand/5" : "border-line hover:bg-canvas"} disabled:cursor-not-allowed`}
            >
              <span className="font-medium">{p.name}</span>
              <span className="mt-0.5 block text-muted">{p.summary}</span>
              {p.id !== "custom" && (
                <span className="mt-2 block space-y-0.5 text-xs text-muted">
                  {p.example.map((e) => <span key={e} className="block">{e}</span>)}
                </span>
              )}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Sequence"
        hint={`A connection request, then messages after they accept. Any reply stops the rest. ${messageCount} message${messageCount === 1 ? "" : "s"} over about ${totalDays} days.`}
      >
        <ol className="space-y-3">
          {v.steps.map((s, i) => (
            <StepCard
              key={s.id}
              step={s}
              index={i}
              count={v.steps.length}
              locked={locked}
              onChange={(n) => setStep(i, n)}
              onRemove={i > 0 ? () => set({ steps: v.steps.filter((_, j) => j !== i) }) : undefined}
            />
          ))}
        </ol>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            {v.steps.length === 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => set({ steps: defaultSteps("custom") })}>
                Add connection request
              </button>
            )}
            {v.steps.length > 0 && messageCount < MAX_MESSAGE_STEPS && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  set({
                    steps: [...v.steps, { id: crypto.randomUUID(), type: "message", waitDays: messageCount ? 3 : 1, mode: "ai", template: "", fallback: "" }],
                  })
                }
              >
                Add message
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title="Sending accounts" hint="Each lead is contacted by one of these accounts from start to finish. Members can choose their own accounts; admins any.">
        {props.accounts.length === 0 ? (
          <p className="text-sm text-muted">No accounts yet. <Link href="/accounts" className="text-brand hover:underline">Connect one</Link>.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {props.accounts.map((a) => {
              const checked = v.accountIds.includes(a.id);
              const problem = a.status !== "ok" ? "Not connected" : !a.enabled ? "Switched off" : null;
              return (
                <li key={a.id}>
                  <label className={`flex items-start gap-2 rounded-lg border border-line p-3 text-sm ${!a.usable && !checked ? "opacity-50" : ""}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={!a.usable && !checked}
                      onChange={() => set({ accountIds: checked ? v.accountIds.filter((x) => x !== a.id) : [...v.accountIds, a.id] })}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="text-xs text-muted">
                        {[a.hasSalesNav ? "Sales Navigator" : null, `warm-up limit ${a.dailyInviteLimit} invites/day`].filter(Boolean).join(" · ")}
                      </span>
                      {problem && <span className="block text-xs text-amber-800">{problem}</span>}
                      {!a.usable && <span className="block text-xs text-muted">Another teammate&apos;s account</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Sending window" hint="Nothing is sent outside these days and hours, in this timezone.">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Active days">
          {DAYS.map((d, i) => {
            const on = v.activeDays.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set({ activeDays: on ? v.activeDays.filter((x) => x !== i) : [...v.activeDays, i] })}
                className={`btn px-3 py-1.5 ${on ? "btn-primary" : "btn-secondary"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            From
            <input type="time" value={v.activeFrom} onChange={(e) => set({ activeFrom: e.target.value })} className="input mt-1" />
          </label>
          <label className="block text-sm font-medium">
            To
            <input type="time" value={v.activeTo} onChange={(e) => set({ activeTo: e.target.value })} className="input mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Timezone
            <select value={v.timezone} onChange={(e) => set({ timezone: e.target.value })} className="input mt-1">
              {props.timezones.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Daily limits" hint="Per sending account, per day. The account's own warm-up limit applies too, whichever is lower.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Connection requests per day
            <input
              type="number"
              min={1}
              max={LIMITS.invites}
              value={v.dailyInviteLimit}
              onChange={(e) => set({ dailyInviteLimit: Number(e.target.value) })}
              className="input mt-1 w-32"
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              Up to {LIMITS.invites}; about 75 a week is the safe ceiling.
              {lowestWarmup !== null && lowestWarmup < v.dailyInviteLimit && ` Some accounts are still warming up and will send ${lowestWarmup}.`}
            </span>
          </label>
          <label className="block text-sm font-medium">
            Messages per day
            <input
              type="number"
              min={1}
              max={LIMITS.messages}
              value={v.dailyMessageLimit}
              onChange={(e) => set({ dailyMessageLimit: Number(e.target.value) })}
              className="input mt-1 w-32"
            />
            <span className="mt-1 block text-xs font-normal text-muted">Up to {LIMITS.messages}.</span>
          </label>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-3 md:-mx-8 md:px-8">
        <button type="button" disabled={saving} onClick={() => save(true)} className="btn btn-primary">
          {saving ? "Saving…" : "Save and review"}
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)} className="btn btn-secondary">Save</button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {saved && !error && <p role="status" className="text-sm text-emerald-700">Saved.</p>}
      </div>
    </div>
  );
}
