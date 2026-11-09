import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { usableAccounts } from "@/lib/permissions";
import { CampaignEditor } from "./editor";

export const instant = false;
export const metadata: Metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({ params }: PageProps<"/campaigns/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c) notFound();
  if (user.role !== "admin" && c.createdByUserId !== user.id) redirect(`/campaigns/${id}`);

  const [products, styles, lists, links, mine, allAccounts] = await Promise.all([
    db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).orderBy(asc(schema.products.name)),
    db.select({ id: schema.writingStyles.id, name: schema.writingStyles.name }).from(schema.writingStyles).orderBy(asc(schema.writingStyles.name)),
    db.select().from(schema.leadLists).orderBy(desc(schema.leadLists.createdAt)).limit(200),
    db.select().from(schema.campaignAccounts).where(eq(schema.campaignAccounts.campaignId, id)),
    usableAccounts(user),
    db.select().from(schema.accounts).orderBy(asc(schema.accounts.name)),
  ]);
  const usable = new Set(mine.map((a) => a.id));
  const onCampaign = new Set(links.map((l) => l.accountId));
  // Admins see every account; members see their own plus any already on the campaign.
  // Only connected accounts the person may use can be newly ticked.
  const accounts = allAccounts
    .filter((a) => user.role === "admin" || a.ownerUserId === user.id || onCampaign.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name || "LinkedIn account",
      status: a.status,
      enabled: a.enabled,
      hasSalesNav: a.hasSalesNav,
      dailyInviteLimit: a.dailyInviteLimit,
      usable: usable.has(a.id),
    }));

  const listOptions = lists
    .filter((l) => l.status === "ready" || l.id === c.leadListId)
    .map((l) => ({ id: l.id, name: l.name, detail: `${l.leadCount.toLocaleString()} leads` }));

  return (
    <div className="max-w-4xl">
      <Link href={`/campaigns/${id}`} className="text-sm text-muted hover:text-ink">← {c.name}</Link>
      <h1 className="mt-2 text-xl font-semibold">{c.status === "draft" ? "Set up campaign" : "Edit campaign"}</h1>
      <div className="mt-6">
        <CampaignEditor
          id={c.id}
          status={c.status}
          initial={{
            name: c.name,
            productId: c.productId,
            writingStyleId: c.writingStyleId,
            leadListId: c.leadListId,
            playbook: c.playbook,
            steps: c.steps,
            accountIds: links.map((l) => l.accountId),
            timezone: c.timezone,
            activeDays: c.activeDays,
            activeFrom: c.activeFrom,
            activeTo: c.activeTo,
            dailyInviteLimit: c.dailyInviteLimit,
            dailyMessageLimit: c.dailyMessageLimit,
          }}
          products={products}
          styles={styles}
          lists={listOptions}
          accounts={accounts}
          timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]}
        />
      </div>
    </div>
  );
}
