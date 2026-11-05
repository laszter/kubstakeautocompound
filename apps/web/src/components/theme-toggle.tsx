"use client";

import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, THEME_LABELS, THEMES, type Theme } from "@/lib/theme";

const ICONS: Record<Theme, LucideIcon> = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };

// The app header mounts two toggles (desktop header + mobile menu, one hidden by CSS at any width) → they share the
// last choice made on this page through a tiny module store. `null` = nothing chosen yet → use the server's value.
let chosen: Theme | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Event-handler only: swap the theme class on <html> instantly (no transitions) and persist it in the cookie. */
function applyTheme(next: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.classList.remove(...THEMES); // never overwrite className (React/Next own the other classes)
  root.classList.add(next);
  document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${
    location.protocol === "https:" ? "; Secure" : ""
  }`;
  void root.offsetHeight; // flush styles while transitions are disabled
  setTimeout(() => root.classList.remove("theme-switching"), 0);
  chosen = next;
  listeners.forEach((listener) => listener());
}

// `initial` comes from the server (cookie read in the layout), so the first client render (server snapshot) already
// matches the <html> class — no mounted guard / effect needed.
export function ThemeToggle({ initial, className }: { initial: Theme; className?: string }) {
  const theme = useSyncExternalStore(
    subscribe,
    () => chosen ?? initial,
    () => initial,
  );
  const buttons = useRef<Partial<Record<Theme, HTMLButtonElement | null>>>({});

  // Radio-group keyboard pattern: arrows move + select, only the checked option is in the tab order.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = THEMES[(THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length];
    applyTheme(next);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="ธีม"
      onKeyDown={onKeyDown}
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-card p-0.5", className)}
    >
      {THEMES.map((t) => {
        const Icon = ICONS[t];
        const checked = t === theme;
        return (
          <button
            key={t}
            ref={(el) => {
              buttons.current[t] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={THEME_LABELS[t]}
            onClick={() => applyTheme(t)}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              checked ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{THEME_LABELS[t]}</span>
          </button>
        );
      })}
    </div>
  );
}
