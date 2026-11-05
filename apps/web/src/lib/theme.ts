// Shared by server (root layout, getTheme) and client (ThemeToggle) — keep free of `server-only` / env imports.

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "system";
export const THEME_COOKIE = "theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_LABELS: Record<Theme, string> = { light: "สว่าง", dark: "มืด", system: "ตามระบบ" };

/** keep in sync with --background in globals.css (used for <meta name="theme-color">) */
export const THEME_COLORS = { light: "#FBFAFC", dark: "#0E1114" } as const;

/** Whitelist an untrusted value (cookie) → Theme; anything else falls back to DEFAULT_THEME. */
export function parseTheme(v: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(v ?? "") ? (v as Theme) : DEFAULT_THEME;
}
