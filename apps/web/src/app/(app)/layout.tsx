import Link from "next/link";
import { LogOutIcon, RefreshCwIcon } from "lucide-react";
import { MobileNav } from "@/components/mobile-nav";
import { Nav } from "@/components/nav";
import { SubmitButton } from "@/components/submit-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkerStatus } from "@/components/worker-status";
import { requireSession } from "@/lib/auth";
import { getTheme } from "@/lib/theme-server";
import { logout } from "../login/actions";

// Every page below reads cookies/DB per request. Pages must still call requireSession() themselves:
// a layout is not re-rendered on client-side navigation between its pages.
export const dynamic = "force-dynamic";

const CONTAINER = "mx-auto w-full max-w-[1260px] px-4 md:px-8";

// Header widths: everything fits in one 64px row from `lg`; below that the nav links, theme toggle and logout move
// into the hamburger panel (MobileNav) and only brand + worker chips stay in the bar.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const theme = await getTheme();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* sticky = positioned → the MobileNav panel anchors to it (top-full) */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className={`${CONTAINER} flex h-16 items-center gap-2 sm:gap-3 lg:gap-8`}>
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-lg font-semibold tracking-tight whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <RefreshCwIcon className="size-4" />
            </span>
            KUB Stake
            <span className="hidden font-normal text-muted-foreground sm:inline lg:hidden xl:inline">Auto-Compound</span>
          </Link>
          <Nav className="hidden lg:flex" />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <WorkerStatus />
            <ThemeToggle initial={theme} className="hidden lg:inline-flex" />
            <form action={logout} className="hidden lg:block">
              <SubmitButton variant="ghost" size="sm" pendingText="กำลังออก...">
                <LogOutIcon />
                ออกจากระบบ
              </SubmitButton>
            </form>
            <MobileNav className="-mr-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground" aria-hidden="true">
                  ธีม
                </span>
                <ThemeToggle initial={theme} />
              </div>
              <form action={logout}>
                <SubmitButton variant="outline" size="sm" pendingText="กำลังออก...">
                  <LogOutIcon />
                  ออกจากระบบ
                </SubmitButton>
              </form>
            </MobileNav>
          </div>
        </div>
      </header>
      <main className={`${CONTAINER} flex-1 py-6 md:py-8`}>{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <div className={CONTAINER}>KUB Stake Auto-Compound · self-hosted · ข้อมูลอัปเดตโดย worker ทุกรอบ</div>
      </footer>
    </div>
  );
}
