"use client";

import { useActionState } from "react";
import { SaveNote } from "@/components/save-note";
import { keepFieldsOnSubmit } from "@/components/use-keep-form";
import type { WritingStyle } from "@/db/schema";
import { saveStyle } from "../../actions";

export function RulesForm({ style, products }: { style: WritingStyle; products: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveStyle, null);
  return (
    <form onSubmit={keepFieldsOnSubmit(action)} className="card space-y-4 p-5">
      <input type="hidden" name="id" value={style.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Style name
          <input name="name" defaultValue={style.name} required className="input mt-1" />
        </label>
        <label className="text-sm font-medium">
          Default product
          <select name="defaultProductId" defaultValue={style.defaultProductId ?? ""} className="input mt-1">
            <option value="">None</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-medium">
          Do
          <span className="block text-xs font-normal text-muted">One rule per line.</span>
          <textarea
            name="do"
            rows={10}
            defaultValue={style.rules.do.join("\n")}
            placeholder="Keep it under 40 words."
            className="input mt-1.5"
          />
        </label>
        <label className="text-sm font-medium">
          Don&apos;t
          <span className="block text-xs font-normal text-muted">One rule per line, written without &quot;don&apos;t&quot;.</span>
          <textarea
            name="dont"
            rows={10}
            defaultValue={style.rules.dont.join("\n")}
            placeholder="Use exclamation marks."
            className="input mt-1.5"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? "Saving…" : "Save rules"}</button>
        <SaveNote state={state} />
      </div>
    </form>
  );
}
