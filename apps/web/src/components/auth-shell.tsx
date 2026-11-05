import { RefreshCwIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTheme } from "@/lib/theme-server";

type Props = { title: string; description: string; children: React.ReactNode };

/** Full-page brand + card layout of the pages shown before login (/login, /setup). */
export async function AuthShell({ title, description, children }: Props) {
  const theme = await getTheme();

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center bg-background px-4 py-16">
      <ThemeToggle initial={theme} className="absolute top-4 right-4 md:top-6 md:right-8" />
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* Own typographic brand (same mark as the app header) */}
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <RefreshCwIcon className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            KUB Stake <span className="font-normal text-muted-foreground">Auto-Compound</span>
          </h1>
        </div>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

/** Shown on /login and /setup when the admin credential can't be read. */
export function SystemNotReadyAlert() {
  return (
    <Alert variant="destructive">
      <AlertTitle>ระบบยังไม่พร้อม</AlertTitle>
      <AlertDescription>อ่านฐานข้อมูลไม่สำเร็จ — ตรวจว่า db และ migrate ทำงานแล้ว แล้วรีเฟรชอีกครั้ง</AlertDescription>
    </Alert>
  );
}
