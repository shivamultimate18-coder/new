import type { Campaign } from "@/db/schema";

const STYLES: Record<Campaign["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-zinc-100 text-zinc-700" },
  running: { label: "Running", tone: "bg-emerald-50 text-emerald-800" },
  paused: { label: "Paused", tone: "bg-amber-50 text-amber-800" },
  completed: { label: "Completed", tone: "bg-blue-50 text-blue-800" },
};

export function CampaignStatus({ status }: { status: Campaign["status"] }) {
  const s = STYLES[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>;
}
