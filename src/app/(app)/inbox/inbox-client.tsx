"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { markRead, sendInboxReply, suggestInboxReply, syncInbox } from "./actions";

/** Marks the open conversation as read once it is shown. */
export function MarkRead({ id, unread }: { id: string; unread: boolean }) {
  useEffect(() => {
    if (unread) void markRead(id);
  }, [id, unread]);
  return null;
}

export function SyncButton() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {note && <span role="status" className="text-xs text-muted">{note}</span>}
      <button
        type="button"
        disabled={busy}
        className="btn btn-secondary"
        onClick={() =>
          start(async () => {
            const r = await syncInbox();
            setNote(r.error ?? (r.added ? `${r.added} new message${r.added === 1 ? "" : "s"}` : "Up to date"));
            router.refresh();
          })
        }
      >
        {busy ? "Syncing…" : "Sync"}
      </button>
    </div>
  );
}

export function ReplyBox({ id, canSend, accountName }: { id: string; canSend: boolean; accountName: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [suggesting, startSuggest] = useTransition();
  const [sending, startSend] = useTransition();
  if (!canSend) {
    return <p className="text-sm text-muted">Only the owner of {accountName} or an admin can reply from this account.</p>;
  }
  return (
    <div className="space-y-2">
      <label htmlFor="reply" className="sr-only">Reply</label>
      <textarea
        id="reply"
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
        placeholder={`Reply as ${accountName}`}
        className="input text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={sending || !text.trim()}
          className="btn btn-primary"
          onClick={() =>
            startSend(async () => {
              setError(null);
              const r = await sendInboxReply(id, text);
              if (r.error) setError(r.error);
              else {
                setText("");
                setSent(true);
                router.refresh();
              }
            })
          }
        >
          {sending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          disabled={suggesting}
          className="btn btn-secondary"
          onClick={() =>
            startSuggest(async () => {
              setError(null);
              const r = await suggestInboxReply(id);
              if (r.error) setError(r.error);
              else if (r.text) setText(r.text);
            })
          }
        >
          {suggesting ? "Writing…" : "Suggest a reply"}
        </button>
        {sent && <span role="status" className="text-sm text-emerald-700">Sent.</span>}
        {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      </div>
    </div>
  );
}
