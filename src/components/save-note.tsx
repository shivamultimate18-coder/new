"use client";

import type { SaveState } from "@/app/(app)/voice/actions";

export function SaveNote({ state }: { state: SaveState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-amber-800" : "text-red-700"}`}>
        {state.error}
      </p>
    );
  }
  return <p role="status" className="text-sm text-emerald-700">Saved.</p>;
}
