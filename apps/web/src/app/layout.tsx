import type { Metadata, Viewport } from "next";
import { THEME_COLORS } from "@/lib/theme";
import { getTheme } from "@/lib/theme-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "KUB Stake Auto-Compound",
  description: "Auto-compound KUB staking rewards (KUB Chain mainnet)",
};

// Matches the server-rendered theme class, so native controls/scrollbars and the browser chrome agree before CSS loads.
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return {
    colorScheme: theme === "system" ? "light dark" : theme,
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
          ]
        : THEME_COLORS[theme],
  };
}

// Font: Anuphan Variable bundled via @fontsource-variable/anuphan (imported in globals.css) — no network at build time.
// Theme: class on <html> from the `theme` cookie (light | dark | system) — no inline script, no flash; `system`
// follows prefers-color-scheme in CSS (see globals.css).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getTheme();
  return (
    <html lang="th" className={`h-full antialiased ${theme}`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
