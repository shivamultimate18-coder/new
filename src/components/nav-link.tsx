"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const path = usePathname();
  const active = href === "/" || href === "/accounts" ? path === href : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-lg px-3 py-1.5 text-sm ${
        active ? "bg-brand/10 font-medium text-brand" : "text-ink hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
