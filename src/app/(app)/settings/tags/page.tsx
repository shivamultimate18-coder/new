import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { ConfirmButton } from "@/components/confirm-button";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { TAG_COLORS, tagClass } from "@/lib/tag-colors";
import { createTag, deleteTag, updateTag } from "../../inbox/actions";

export const instant = false;
export const metadata: Metadata = { title: "Tags" };

function ColorPicker({ name, value }: { name: string; value: string }) {
  return (
    <fieldset className="flex flex-wrap gap-1.5">
      <legend className="sr-only">Colour</legend>
      {Object.keys(TAG_COLORS).map((c) => (
        <label key={c} className="cursor-pointer">
          <input type="radio" name={name} value={c} defaultChecked={c === value} className="peer sr-only" />
          <span className={`block h-6 w-6 rounded-full ring-offset-1 peer-checked:ring-2 peer-checked:ring-brand peer-focus-visible:ring-2 ${tagClass(c)}`} title={c} />
          <span className="sr-only">{c}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default async function TagsPage() {
  const user = await requireUser();
  const tags = await db
    .select({ t: schema.tags, used: count(schema.conversationTags.conversationId) })
    .from(schema.tags)
    .leftJoin(schema.conversationTags, eq(schema.conversationTags.tagId, schema.tags.id))
    .groupBy(schema.tags.id)
    .orderBy(asc(schema.tags.name));
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">Tags</h1>
      <p className="mt-1 text-sm text-muted">Labels for inbox conversations, such as booked or follow up in January.</p>

      <form action={createTag} className="card mt-6 space-y-3 p-4">
        <label className="block text-sm font-medium">
          New tag
          <input name="name" required maxLength={40} placeholder="e.g. booked" className="input mt-1 max-w-xs" />
        </label>
        <ColorPicker name="color" value="blue" />
        <button type="submit" className="btn btn-primary">Add tag</button>
      </form>

      <ul className="card mt-6 divide-y divide-line">
        {tags.map(({ t, used }) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
            <form action={updateTag} className="flex flex-1 flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={t.id} />
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tagClass(t.color)}`}>{t.name}</span>
              <input name="name" defaultValue={t.name} maxLength={40} className="input w-40" aria-label={`Rename ${t.name}`} />
              <ColorPicker name="color" value={t.color} />
              <button type="submit" className="btn btn-secondary">Save</button>
              <span className="text-xs text-muted">{used} conversation{used === 1 ? "" : "s"}</span>
            </form>
            {user.role === "admin" && (
              <form action={deleteTag}>
                <input type="hidden" name="id" value={t.id} />
                <ConfirmButton message={`Delete the tag "${t.name}"? It is removed from ${used} conversations.`} className="btn btn-danger">Delete</ConfirmButton>
              </form>
            )}
          </li>
        ))}
        {tags.length === 0 && <li className="p-6 text-center text-sm text-muted">No tags yet.</li>}
      </ul>
    </div>
  );
}
