import { getSettings, type SettingsRow } from "@kubstake/db";
import { ActivityIcon, InfoIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { KvList } from "@/components/kv";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DryRunBadge } from "@/components/worker-status";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDateTime, formatDuration, formatGwei, relativeTime } from "@/lib/format";
import { getWorkerStatus, WORKER_FRESH_SEC, type WorkerStatusInfo } from "@/lib/worker";
import { PasswordForm } from "./password-form";
import { SettingsForm } from "./settings-form";
import { settingsToFormValues } from "./settings-fields";

export const metadata: Metadata = { title: "ตั้งค่า · KUB Stake Auto-Compound" };

async function load(): Promise<{ settings: SettingsRow | null; worker: WorkerStatusInfo | null; error: string | null }> {
  try {
    const [settings, worker] = await Promise.all([getSettings(getDb()).catch(() => null), getWorkerStatus()]);
    return { settings, worker, error: null };
  } catch (err) {
    console.error(`[settings] ${err instanceof Error ? err.message : String(err)}`);
    return { settings: null, worker: null, error: "อ่านข้อมูลจากฐานข้อมูลไม่สำเร็จ" };
  }
}

/** Key/value row inside <KvList> (same layout as the position detail rows) — stacked below sm. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-all">{children}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  await requireSession();
  const { settings, worker, error } = await load();
  const hb = worker?.heartbeat ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ตั้งค่า"
        description="ค่ากลางของ auto-compound engine (ใช้กับทุก position) — แก้แล้วมีผลในรอบถัดไปของ worker"
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>ฐานข้อมูลไม่พร้อม</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Auto-compound settings</CardTitle>
          <CardDescription>
            หน่วย: KUB / gwei / วินาที
            {settings ? ` · แก้ไขล่าสุด ${formatDateTime(settings.updatedAt)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? (
            <SettingsForm initial={settingsToFormValues(settings)} />
          ) : !error ? (
            <Alert variant="info">
              <InfoIcon />
              <AlertTitle>ยังไม่มีค่า app_settings</AlertTitle>
              <AlertDescription>
                worker จะสร้างค่าเริ่มต้นจาก env (GAS_RESERVE_KUB, MAX_GAS_PRICE_GWEI, ...) ตอนเริ่มทำงานครั้งแรก —
                ตรวจว่า migrate และ worker รันแล้ว
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            Worker {hb?.dryRun ? <DryRunBadge /> : null}
          </CardTitle>
          <CardDescription>
            จาก worker_heartbeat — ถือว่าทำงานอยู่ถ้า tick ล่าสุดไม่เกิน {WORKER_FRESH_SEC} วินาที
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hb ? (
            <KvList>
              <InfoRow label="สถานะ">
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  {worker?.fresh ? (
                    <StatusBadge kind="success" dot>
                      ทำงาน
                    </StatusBadge>
                  ) : (
                    <StatusBadge kind="danger" dot>
                      ไม่ตอบสนอง
                    </StatusBadge>
                  )}
                  <span>
                    tick ล่าสุด {formatDateTime(hb.lastTickAt)} ({relativeTime(hb.lastTickAt)})
                  </span>
                </span>
              </InfoRow>
              <InfoRow label="Version">{hb.version}</InfoRow>
              <InfoRow label="Instance">{hb.instanceId}</InfoRow>
              <InfoRow label="เริ่มทำงาน">
                {formatDateTime(hb.startedAt)} (uptime {formatDuration((hb.lastTickAt.getTime() - hb.startedAt.getTime()) / 1000)})
              </InfoRow>
              <InfoRow label="Tick count">{hb.tickCount.toLocaleString("en-US")}</InfoRow>
              <InfoRow label="Chain ID">{hb.chainId ?? "-"}</InfoRow>
              <InfoRow label="Block ล่าสุด">{hb.blockNumber !== null ? hb.blockNumber.toLocaleString("en-US") : "-"}</InfoRow>
              <InfoRow label="Gas price">{hb.gasPriceWei !== null ? `${formatGwei(hb.gasPriceWei)} gwei` : "-"}</InfoRow>
              <InfoRow label="DRY_RUN">
                {hb.dryRun ? "true — จำลองเท่านั้น ไม่ส่ง transaction จริง" : "false — ส่ง transaction จริงบน mainnet"}
              </InfoRow>
              <InfoRow label="Error ล่าสุด">
                {hb.lastError ? <span className="text-destructive">{hb.lastError}</span> : "-"}
              </InfoRow>
              <InfoRow label="เขตเวลา (web)">{env.APP_TIMEZONE}</InfoRow>
            </KvList>
          ) : !error ? (
            <EmptyState
              icon={ActivityIcon}
              title="ยังไม่มี heartbeat จาก worker"
              description="worker ยังไม่เคยรัน หรือยังไม่ได้เชื่อมฐานข้อมูลนี้"
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>เปลี่ยนรหัสผ่าน</CardTitle>
          <CardDescription>หลังเปลี่ยน อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
