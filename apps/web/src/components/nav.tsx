"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/", label: "แดชบอร์ด" },
  { href: "/wallets", label: "กระเป๋า" },
  { href: "/validators", label: "Validators" },
  { href: "/settings", label: "ตั้งค่า" },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/positions");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop top-nav (the layout hides it below `lg`; MobileNav takes over there). Active = green text + a 2px brand
 * underline sitting on the header's bottom hairline (link is h-9 centred in the h-16 header → offset -14px).
 */
export function Nav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="เมนูหลัก" className={cn("flex items-center gap-6", className)}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-9 items-center rounded-md text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card",
              active
                ? "font-semibold text-primary after:absolute after:inset-x-0 after:-bottom-3.5 after:h-0.5 after:rounded-full after:bg-brand"
                : "text-foreground/75 hover:text-foreground",
            )}
          >
            {/* invisible bold copy reserves the semibold width → links don't shift when the active item changes */}
            <span className="grid justify-items-center">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-semibold">
                {item.label}
              </span>
              <span className="col-start-1 row-start-1">{item.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
