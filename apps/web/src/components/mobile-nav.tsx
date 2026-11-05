"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { isActive, NAV_ITEMS } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Hamburger menu below `lg` (the desktop `<Nav/>` + header controls don't fit there). The panel drops down under the
 * sticky header (the header is the positioned ancestor → `top-full`), lists NAV_ITEMS and renders `children` (theme
 * toggle + logout from the layout) in a bottom row. Closes on link click, Escape, outside tap and any route change.
 */
export function MobileNav({ children, className }: { children?: ReactNode; className?: string }) {
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // Route changed some other way (back/forward, redirect) → close. "Adjust state during render" — no effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label="เมนู"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={cn("lg:hidden", className)}
      >
        {open ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
      </Button>
      {open ? (
        // Transparent click-catcher below the header: tapping the page closes the menu (no dim, like the reference).
        <div aria-hidden="true" className="fixed inset-x-0 top-16 bottom-0 lg:hidden" onClick={() => setOpen(false)} />
      ) : null}
      <div
        id={panelId}
        hidden={!open}
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-y border-border bg-card lg:hidden"
      >
        <nav aria-label="เมนูหลัก">
          <ul className="flex flex-col py-2">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative block px-4 py-3 text-base transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:px-8",
                      active
                        ? "font-semibold text-primary before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
                        : "text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {children ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-8">
            {children}
          </div>
        ) : null}
      </div>
    </>
  );
}
