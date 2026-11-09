import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Campaign } from "@/db/schema";
import { INVITE_NOTE_MAX, unknownVariables } from "./template";

export type Check = { id: string; label: string; ok: boolean; detail: string };

/** Everything that must be true before a campaign can launch. */
export async function readiness(c: Campaign): Promise<Check[]> {
  const [product] = c.productId ? await db.select().from(schema.products).where(eq(schema.products.id, c.productId)) : [];
  const [style] = c.writingStyleId
    ? await db.select().from(schema.writingStyles).where(eq(schema.writingStyles.id, c.writingStyleId))
    : [];
  const [list] = c.leadListId ? await db.select().from(schema.leadLists).where(eq(schema.leadLists.id, c.leadListId)) : [];
  const links = await db
    .select({ accountId: schema.campaignAccounts.accountId })
    .from(schema.campaignAccounts)
    .where(eq(schema.campaignAccounts.campaignId, c.id));
  const accounts = links.length
    ? await db.select().from(schema.accounts).where(inArray(schema.accounts.id, links.map((l) => l.accountId)))
    : [];
  const usable = accounts.filter((a) => a.status === "ok" && a.enabled);

  const invite = c.steps[0];
  const messages = c.steps.filter((s) => s.type === "message");
  const usesAi = messages.some((m) => m.mode === "ai");
  const productComplete = product && [product.description, product.valueProps, product.painPoints, product.proofPoints].every((v) => v.trim());

  const stepProblems: string[] = [];
  if (!invite || invite.type !== "invite") stepProblems.push("The sequence must start with a connection request.");
  if (!messages.length) stepProblems.push("Add at least one message after the connection request.");
  c.steps.forEach((s, i) => {
    const label = i === 0 ? "Connection request" : `Message ${i}`;
    if (s.mode === "template") {
      if (!s.template.trim()) stepProblems.push(`${label} has no text.`);
      const bad = [...unknownVariables(s.template), ...unknownVariables(s.fallback)];
      if (bad.length) stepProblems.push(`${label} uses unknown variables: ${bad.map((b) => `{${b}}`).join(", ")}.`);
      if (s.type === "invite" && Math.max(s.template.length, s.fallback.length) > INVITE_NOTE_MAX) {
        stepProblems.push(`The connection note is over ${INVITE_NOTE_MAX} characters.`);
      }
    }
  });
  const noteNeedsSalesNav = invite?.mode === "template" && usable.some((a) => !a.hasSalesNav);

  return [
    {
      id: "list",
      label: "Lead list",
      ok: !!list && list.status === "ready" && list.leadCount > 0,
      detail: !list ? "Choose a lead list." : list.status !== "ready" ? `"${list.name}" is still importing.` : list.leadCount === 0 ? `"${list.name}" has no leads.` : `${list.name} · ${list.leadCount.toLocaleString()} leads`,
    },
    {
      id: "voice",
      label: "Product and writing style",
      ok: !usesAi || (!!productComplete && !!style),
      detail: !usesAi
        ? "Not needed: every message is a fixed template."
        : !product
          ? "Choose a product."
          : !productComplete
            ? `Fill in the required fields of "${product.name}".`
            : !style
              ? "Choose a writing style."
              : `${product.name} · ${style.name}`,
    },
    {
      id: "steps",
      label: "Sequence",
      ok: stepProblems.length === 0,
      detail: stepProblems[0] ?? `Connection request + ${messages.length} message${messages.length === 1 ? "" : "s"}`,
    },
    {
      id: "accounts",
      label: "Sending accounts",
      ok: usable.length > 0 && !noteNeedsSalesNav,
      detail: noteNeedsSalesNav
        ? "A note on the connection request needs Sales Navigator on every sending account. Remove the note or those accounts."
        : usable.length
          ? `${usable.length} connected and switched on${accounts.length > usable.length ? `, ${accounts.length - usable.length} not usable` : ""}`
          : accounts.length
            ? "None of the chosen accounts is connected and switched on."
            : "Choose at least one LinkedIn account.",
    },
    {
      id: "schedule",
      label: "Sending window",
      ok: c.activeDays.length > 0 && c.activeFrom < c.activeTo,
      detail:
        c.activeDays.length === 0
          ? "Choose at least one day."
          : c.activeFrom >= c.activeTo
            ? "The start time must be before the end time."
            : `${c.activeFrom} to ${c.activeTo}, ${c.timezone}`,
    },
  ];
}
