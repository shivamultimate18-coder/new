import { logout } from "@/app/login/actions";
import { NavLink } from "@/components/nav-link";
import { requireUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/env";

// Every page here is per-user and reads the session cookie, so it renders on request.
export const instant = false;

// Sections arrive phase by phase (docs/ACTION_PLAN.md section 6).
const NAV: { group: string; items: { label: string; href?: string }[] }[] = [
  { group: "", items: [{ label: "Home", href: "/" }] },
  { group: "Discover", items: [{ label: "Lead Sources", href: "/lead-sources" }] },
  { group: "Execute", items: [{ label: "Campaigns", href: "/campaigns" }, { label: "Message Review", href: "/message-review" }, { label: "Voice", href: "/voice" }] },
  { group: "Converse", items: [{ label: "Inbox" }] },
  {
    group: "Settings",
    items: [
      { label: "Accounts", href: "/accounts" },
      { label: "Team", href: "/settings/team" },
    ],
  },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:flex md:w-56 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="px-5 py-4 text-base font-semibold">{APP_NAME}</div>
        <nav className="flex flex-wrap gap-x-4 px-2 pb-3 md:block md:flex-1 md:space-y-4">
          {NAV.map((g) => (
            <div key={g.group}>
              {g.group && (
                <div className="hidden px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted md:block">
                  {g.group}
                </div>
              )}
              <div className="flex md:block">
                {g.items.map((item) =>
                  item.href ? (
                    <NavLink key={item.label} href={item.href} label={item.label} />
                  ) : (
                    <span
                      key={item.label}
                      title="Not built yet"
                      className="hidden cursor-default px-3 py-1.5 text-sm text-muted/60 md:block"
                    >
                      {item.label}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm">
          <span className="truncate" title={user.email}>
            {user.name}
          </span>
          <form action={logout}>
            <button type="submit" className="text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
