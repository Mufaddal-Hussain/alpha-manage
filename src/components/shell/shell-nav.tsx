"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import type { NavItem } from "./nav-items";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = [...new Set(items.map((i) => i.group ?? ""))];
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group} className="flex flex-col gap-1">
          {group ? <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted">{group}</p> : null}
          {items
            .filter((i) => (i.group ?? "") === group)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className="rounded-md px-3 py-2 text-sm hover:bg-border/60 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
        </div>
      ))}
    </nav>
  );
}

function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/60"
    >
      Sign out
    </button>
  );
}

/** Sidebar on wide screens; a header with a slide-down menu on phones. */
export function ShellNav({ items, userName, roleLabel }: { items: NavItem[]; userName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface p-4 md:flex">
        <p className="px-3 text-lg font-semibold tracking-tight">alpha-Manage</p>
        <NavList items={items} />
        <div className="mt-auto flex flex-col gap-2 border-t border-border px-3 pt-4">
          <p className="text-sm font-medium">{userName}</p>
          <p className="text-xs capitalize text-muted">{roleLabel}</p>
          <SignOutButton />
        </div>
      </aside>

      <header className="border-b border-border bg-surface md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-semibold tracking-tight">alpha-Manage</p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
        {open ? (
          <div id="mobile-menu" className="flex flex-col gap-4 border-t border-border px-4 py-4">
            <NavList items={items} onNavigate={() => setOpen(false)} />
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs capitalize text-muted">{roleLabel}</p>
              </div>
              <SignOutButton />
            </div>
          </div>
        ) : null}
      </header>
    </>
  );
}
