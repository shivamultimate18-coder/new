import type { LeadList } from "@/db/schema";

const STYLES: Record<LeadList["status"], { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "bg-zinc-100 text-zinc-700" },
  running: { label: "Importing", tone: "bg-blue-50 text-blue-800" },
  waiting: { label: "Waiting", tone: "bg-amber-50 text-amber-800" },
  ready: { label: "Ready", tone: "bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-800" },
  cancelled: { label: "Stopped", tone: "bg-zinc-100 text-zinc-700" },
};

export const SOURCE_LABEL: Record<LeadList["source"], string> = {
  sales_nav: "Sales Navigator",
  csv: "CSV",
  basic_search: "Basic Search",
};

export function ListStatus({ status }: { status: LeadList["status"] }) {
  const s = STYLES[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>;
}

export const ACTIVE_STATUSES: LeadList["status"][] = ["queued", "running", "waiting"];

export function listDetail(l: LeadList): string {
  if (l.status === "failed") return l.error ?? "Failed";
  if (l.status === "waiting") return "Daily search limit reached for this account. Continues tomorrow.";
  if (l.source === "csv") return "Ready for campaigns";
  if (l.status === "queued") return `Starting · ${l.pagesRequested} page${l.pagesRequested === 1 ? "" : "s"}`;
  if (l.status === "running") return `Page ${l.pagesDone} of ${l.pagesRequested}`;
  if (l.status === "cancelled") return `Stopped after ${l.pagesDone} of ${l.pagesRequested} pages`;
  return "Ready for campaigns";
}

export function ago(d: Date | null): string {
  if (!d) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.floor(mins / (60 * 24));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
