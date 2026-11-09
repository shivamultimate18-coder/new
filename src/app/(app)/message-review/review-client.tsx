"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RuleSet } from "@/db/schema";
import { RuleProposals } from "../voice/styles/[id]/playground";
import { proposeRulesFromReview, regenerateLead, saveDraft } from "./actions";

export function DraftEditor({ id, body, warnings, locked }: { id: string; body: string; warnings: string[]; locked: boolean }) {
  const [text, setText] = useState(body);
  const [saved, setSaved] = useState(body);
  const [warn, setWarn] = useState(warnings);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const dirty = text !== saved;
  return (
    <div>
      <textarea
        value={text}
        disabled={locked}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(10, Math.max(3, Math.ceil(text.length / 70)))}
        className="input text-sm leading-relaxed"
        aria-label="Message text"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted">{text.trim().split(/\s+/).filter(Boolean).length} words</span>
        {dirty && !locked && (
          <>
            <button
              type="button"
              disabled={saving}
              className="btn btn-secondary px-2.5 py-1 text-xs"
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await saveDraft(id, text);
                  if (r.error) setError(r.error);
                  else {
                    setSaved(text.trim());
                    setText(text.trim());
                    setWarn(r.warnings ?? []);
                  }
                })
              }
            >
              {saving ? "Saving…" : "Save edit"}
            </button>
            <button type="button" className="text-muted hover:text-ink" onClick={() => setText(saved)}>Undo</button>
          </>
        )}
        {error && <span role="alert" className="text-red-700">{error}</span>}
      </div>
      {warn.length > 0 && (
        <ul role="alert" className="mt-2 list-disc rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">
          {warn.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

export function RegenerateBox({ leadStateId }: { leadStateId: string }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted">
        Regenerate the unsent messages
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Optional: what to do differently, e.g. lead with their recent hiring"
          className="input mt-1 text-sm font-normal text-ink"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        className="btn btn-secondary"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await regenerateLead(leadStateId, instruction);
            if (r.error) setError(r.error);
            else {
              setInstruction("");
              router.refresh();
            }
          })
        }
      >
        {busy ? "Regenerating… (10 to 30 seconds)" : "Regenerate"}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function TeachStyleBox({ leadStateId }: { leadStateId: string }) {
  const [feedback, setFeedback] = useState("");
  const [proposal, setProposal] = useState<{ rules: RuleSet; styleId: string } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (done) return <p role="status" className="text-sm text-emerald-700">Rules added to the writing style. They apply to drafts written from now on.</p>;
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted">
        Teach the writing style
        <textarea
          rows={2}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What is wrong with these drafts in general? e.g. openers are too formal"
          className="input mt-1 text-sm font-normal text-ink"
        />
      </label>
      <button
        type="button"
        disabled={busy || !feedback.trim()}
        className="btn btn-secondary"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await proposeRulesFromReview(leadStateId, feedback);
            if (r.error) setError(r.error);
            else if (r.rules && r.styleId) setProposal({ rules: r.rules, styleId: r.styleId });
          })
        }
      >
        {busy ? "Thinking…" : "Suggest rules"}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {proposal && <RuleProposals styleId={proposal.styleId} rules={proposal.rules} onDone={() => setDone(true)} />}
    </div>
  );
}
