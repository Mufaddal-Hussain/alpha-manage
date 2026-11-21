"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
                className="flex items-center rounded-md px-3 py-2 text-sm hover:bg-border/60 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
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

/** Sidebar on wide screens; a sticky header with a slide-in drawer on phones. */
export function ShellNav({ items, userName, roleLabel }: { items: NavItem[]; userName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // While the drawer is open: Escape closes it, the page behind does not scroll, and focus starts on its Close button
  // and goes back to the Menu button afterwards.
  useEffect(() => {
    if (!open) return;
    const button = menuButton.current;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      button?.focus();
    };
  }, [open]);

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

      <header className="sticky top-0 z-30 border-b border-border bg-surface pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:hidden">
        <div className="flex items-center justify-between px-4 py-1">
          <p className="font-semibold tracking-tight">alpha-Manage</p>
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen(true)}
            className="rounded-md border border-border px-4 text-sm"
          >
            Menu
          </button>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 h-full w-full bg-black/40" />
          <div
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col gap-4 overflow-y-auto border-l border-border bg-surface pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-4 shadow-xl"
          >
            <div className="flex items-center justify-between pt-1">
              <p className="font-semibold tracking-tight">alpha-Manage</p>
              <button ref={closeButton} type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 text-sm">
                Close
              </button>
            </div>
            <NavList items={items} onNavigate={() => setOpen(false)} />
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{userName}</p>
                <p className="text-xs capitalize text-muted">{roleLabel}</p>
              </div>
              <SignOutButton />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
