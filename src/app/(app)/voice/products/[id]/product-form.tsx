"use client";

import { useActionState, useState, useTransition } from "react";
import { SaveNote } from "@/components/save-note";
import { keepFieldsOnSubmit } from "@/components/use-keep-form";
import type { Product } from "@/db/schema";
import { saveProduct, suggestIcp } from "../../actions";

function Field(props: {
  name: keyof Product | "pitchDo" | "pitchDont";
  label: string;
  hint: string;
  required?: boolean;
  rows?: number;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
}) {
  const id = `f-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
        {props.required && <span className="text-red-700"> *</span>}
      </label>
      <p className="text-xs text-muted">{props.hint}</p>
      {props.rows ? (
        <textarea
          id={id}
          name={props.name}
          rows={props.rows}
          placeholder={props.placeholder}
          {...(props.onChange ? { value: props.value, onChange: (e) => props.onChange!(e.target.value) } : { defaultValue: props.value })}
          className="input mt-1.5"
        />
      ) : (
        <input id={id} name={props.name} defaultValue={props.value} placeholder={props.placeholder} className="input mt-1.5" />
      )}
    </div>
  );
}

export function ProductForm({ product }: { product: Product }) {
  const [state, action, pending] = useActionState(saveProduct, null);
  const [icp, setIcp] = useState(product.icp);
  const [prevIcp, setPrevIcp] = useState<string | null>(null);
  const [icpError, setIcpError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();

  return (
    <form onSubmit={keepFieldsOnSubmit(action)} className="space-y-6">
      <input type="hidden" name="id" value={product.id} />
      <section className="card space-y-4 p-5">
        <h2 className="font-medium">The offer</h2>
        <Field name="name" label="Name" hint="Short and plain, as you would say it to a prospect." required value={product.name} />
        <Field name="description" label="Description" hint="What you sell, who it is for, and why they buy. A few sentences." required rows={4} value={product.description} />
        <div>
          <Field
            name="icp"
            label="Ideal customer profile"
            hint="Who actually buys: company type, decision-maker titles, signals of fit."
            rows={4}
            value={icp}
            onChange={setIcp}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={drafting}
              onClick={() =>
                startDraft(async () => {
                  setIcpError(null);
                  const r = await suggestIcp(product.id);
                  if (r.error) setIcpError(r.error);
                  else if (r.icp) {
                    setPrevIcp(icp);
                    setIcp(r.icp);
                  }
                })
              }
            >
              {drafting ? "Drafting…" : "Draft with AI"}
            </button>
            {prevIcp !== null && (
              <button type="button" className="btn btn-secondary" onClick={() => { setIcp(prevIcp); setPrevIcp(null); }}>
                Undo
              </button>
            )}
            <span className="text-xs text-muted">Drafts from the saved description. Review it, then save.</span>
          </div>
          {icpError && <p role="alert" className="mt-2 text-sm text-red-700">{icpError}</p>}
        </div>
        <Field name="services" label="Services" hint="If you sell more than one thing, one per line. The writer picks the one that fits each person." rows={3} value={product.services} />
        <Field name="specifics" label="Product specifics" hint="Facts the writer can choose from, not a list to recite." rows={4} value={product.specifics} />
        <Field name="competitors" label="Competitors" hint="Used for positioning only; never named in messages." rows={2} value={product.competitors} />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">Why people buy</h2>
        <Field name="valueProps" label="Value propositions" hint="The specific value you provide. One per line." required rows={4} value={product.valueProps} />
        <Field name="painPoints" label="Pain points" hint="Problems this solves, in the customer's words. One per line." required rows={4} value={product.painPoints} />
        <Field name="proofPoints" label="Proof points" hint="Numbers, quotes or short case notes, with a source when you have one. Used in follow-ups only." required rows={4} value={product.proofPoints} />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">Offer details by step</h2>
        <p className="text-sm text-muted">The opener never includes any of these. The system checks every draft for it.</p>
        <Field name="price" label="Price" hint="In plain words. Used in follow-up 1 only." value={product.price} placeholder="e.g. from $499 a month" />
        <Field name="freeOffer" label="Free offer" hint="Something small you will really do. Used in the last note only; if empty, the last note simply signs off." value={product.freeOffer} placeholder="e.g. Run a free audit of your listing" />
        <Field name="bookingLink" label="Booking link" hint="Used in the last note only." value={product.bookingLink} placeholder="https://" />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">Pitch rules for this product</h2>
        <p className="text-sm text-muted">What to say and avoid about this offer. Tone and length belong in the writing style. One rule per line.</p>
        <Field name="pitchDo" label="Do" hint="" rows={4} value={product.pitchRules.do.join("\n")} placeholder="Mention features only after the problem is clear." />
        <Field name="pitchDont" label="Don't" hint="" rows={4} value={product.pitchRules.dont.join("\n")} placeholder="Promise a number of meetings or leads." />
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-3 md:-mx-8 md:px-8">
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? "Saving…" : "Save product"}</button>
        <SaveNote state={state} />
      </div>
    </form>
  );
}
