import { describeCron } from "@kubstake/core/browser";
import { ActivityIcon, ChevronRightIcon, CircleCheckIcon, LayersIcon, PlusIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { Kub } from "@/components/kub";
import { KvList, KvRow } from "@/components/kv";
import { PageHeader } from "@/components/page-header";
import { StatsStrip } from "@/components/stats-strip";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DryRunBadge } from "@/components/worker-status";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatDuration, formatGwei, formatKub, relativeTime, shortAddr } from "@/lib/format";
import { getWorkerStatus, WORKER_FRESH_SEC, type WorkerStatusInfo } from "@/lib/worker";
import { PositionStatusChips } from "./positions/_components/badges";
import { computePositionHints, DEFAULT_HINT_SETTINGS, isValidatorDelegatable } from "./positions/_lib/hints";
import { loadDashboard } from "./positions/_lib/queries";

type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
type DashboardPosition = Dashboard["positions"][number];
type PositionHints = ReturnType<typeof computePositionHints>;

async function load(): Promise<{ data: Dashboard; worker: WorkerStatusInfo } | null> {
  try {
    const [data, worker] = await Promise.all([loadDashboard(), getWorkerStatus()]);
    return { data, worker };
  } catch (err) {
    console.error(`[dashboard] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function etaLabel(sec: number): string {
  if (sec <= 0) return "ถึงเกณฑ์แล้ว";
  if (!Number.isFinite(sec)) return "ไม่มีกำหนด";
  return `≈ ${formatDuration(sec)}`;
}

function modeLabel(p: DashboardPosition): string {
  return p.strategy === "threshold" && p.thresholdWei !== null
    ? `Threshold ≥ ${formatKub(p.thresholdWei)} KUB`
    : p.strategy === "schedule" && p.cronExpr
      ? `Schedule: ${describeCron(p.cronExpr)}`
      : "Optimal";
}

function validatorLabel(p: DashboardPosition): string {
  return p.validator.name ?? `Validator #${p.validator.validatorId}`;
}

/** "ETA / รอบถัดไป" — next scheduled run for schedule mode, otherwise ETA to R*. Shared by the table and mobile cards. */
function NextRun({ p, hints }: { p: DashboardPosition; hints: PositionHints }) {
  if (p.strategy === "schedule") {
    return p.nextRunAt ? (
      <span title={formatDateTime(p.nextRunAt)}>{formatDateTime(p.nextRunAt)}</span>
    ) : (
      <span className="text-muted-foreground">รอ worker</span>
    );
  }
  return p.principalWei > 0n ? <>{etaLabel(hints.activeEtaSec)}</> : <span className="text-muted-foreground">-</span>;
}

function Chips({ p, hints, className }: { p: DashboardPosition; hints: PositionHints; className?: string }) {
  return (
    <PositionStatusChips
      enabled={p.enabled}
      claimOnly={hints.claimOnly || !isValidatorDelegatable(p.validator)}
      backoffUntil={hints.backoffUntil ? formatDateTime(hints.backoffUntil) : null}
      className={className}
    />
  );
}

export default async function DashboardPage(props: PageProps<"/">) {
  await requireSession();
  const sp = await props.searchParams;
  const loaded = await load();

  if (!loaded) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="แดชบอร์ด" />
        <Alert variant="destructive">
          <AlertTitle>ฐานข้อมูลไม่พร้อม</AlertTitle>
          <AlertDescription>อ่านข้อมูลไม่สำเร็จ — ตรวจว่า db และ migrate ทำงานแล้ว แล้วรีเฟรชอีกครั้ง</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { data, worker } = loaded;
  const settings = data.settings ?? DEFAULT_HINT_SETTINGS;
  const now = new Date();
  const rows = data.positions.map((p) => ({
    p,
    hints: computePositionHints({
      position: p,
      validator: p.validator,
      walletBalanceWei: p.wallet.balanceWei,
      settings,
      gasPriceWei: worker.heartbeat?.gasPriceWei ?? null,
      now,
    }),
  }));

  const totalPrincipal = data.positions.reduce((sum, p) => sum + p.principalWei, 0n);
  const totalPending = data.positions.reduce((sum, p) => sum + p.pendingWei, 0n);
  const knownBalances = data.wallets.filter((w) => w.balanceWei !== null);
  const totalLiquid = knownBalances.reduce((sum, w) => sum + (w.balanceWei ?? 0n), 0n);
  const activeCount = data.positions.filter((p) => p.enabled).length;
  const hb = worker.heartbeat;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />

      {sp.deleted === "1" ? (
        <Alert variant="success">
          <CircleCheckIcon />
          <AlertDescription>ลบ position แล้ว</AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="แดชบอร์ด"
        description="ภาพรวมทุก position (wallet × validator) · อัปเดตอัตโนมัติทุก 15 วินาที"
        actions={
          data.wallets.length > 0 ? (
            <Link href="/positions/new" className={buttonVariants()}>
              <PlusIcon /> สร้าง position
            </Link>
          ) : undefined
        }
      />

      <StatsStrip
        items={[
          { label: "เงินต้นรวม (principal)", value: <Kub value={formatKub(totalPrincipal)} /> },
          { label: "Reward ค้างรวม", value: <Kub value={formatKub(totalPending)} /> },
          {
            label: "KUB ใน wallet รวม (liquid)",
            value: <Kub value={formatKub(totalLiquid)} />,
            hint:
              knownBalances.length < data.wallets.length
                ? `ยังไม่ทราบยอด ${data.wallets.length - knownBalances.length} wallet (รอ worker)`
                : null,
          },
          {
            label: "Wallets / Positions",
            value: (
              <>
                {data.wallets.length} / {data.positions.length}
              </>
            ),
            hint: `auto-compound เปิด ${activeCount} จาก ${data.positions.length} position`,
          },
        ]}
      />

      <Card size="sm">
        <CardContent className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ActivityIcon className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-base font-semibold">Worker</span>
            {worker.fresh ? (
              <StatusBadge kind="success" dot>
                ทำงาน
              </StatusBadge>
            ) : (
              <StatusBadge kind="danger" dot>
                ไม่ตอบสนอง
              </StatusBadge>
            )}
            {worker.dryRun ? <DryRunBadge /> : null}
          </div>
          <p className="min-w-0 text-sm break-words text-muted-foreground">
            {hb
              ? `tick ล่าสุด ${formatDateTime(hb.lastTickAt)} (${relativeTime(hb.lastTickAt)}) · block ${
                  hb.blockNumber !== null ? hb.blockNumber.toLocaleString("en-US") : "-"
                } · gas price ${hb.gasPriceWei !== null ? `${formatGwei(hb.gasPriceWei)} gwei` : "-"}${
                  worker.dryRun ? " · DRY RUN = จำลองเท่านั้น ไม่ส่ง transaction จริง" : ""
                }`
              : `ยังไม่มี heartbeat — worker ยังไม่เคยรันกับฐานข้อมูลนี้ (ถือว่าทำงานถ้า tick ภายใน ${WORKER_FRESH_SEC} วินาที)`}
            {hb?.lastError ? <span className="text-destructive"> · error ล่าสุด: {hb.lastError}</span> : null}
          </p>
        </CardContent>
      </Card>

      {data.wallets.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={WalletIcon}
              title="เริ่มต้นใช้งาน"
              description="ยังไม่มี wallet — เพิ่ม wallet ด้วย private key ก่อน (เข้ารหัสเก็บใน DB, ใช้ hot wallet ที่ใส่เงินเท่าที่จำเป็น) แล้วค่อยสร้าง position"
              action={
                <Link href="/wallets" className={buttonVariants()}>
                  ไปหน้ากระเป๋า
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              Positions <Badge>{rows.length}</Badge>
            </CardTitle>
            <CardDescription>R* / ETA เป็นค่าประมาณจากข้อมูลล่าสุด + gas price ของ worker</CardDescription>
          </CardHeader>
          {rows.length === 0 ? (
            <CardContent>
              <EmptyState
                icon={LayersIcon}
                title="ยังไม่มี position"
                description="เลือก wallet × validator เพื่อเริ่ม stake และ auto-compound"
                action={
                  <Link href="/positions/new" className={buttonVariants()}>
                    <PlusIcon /> สร้าง position แรก
                  </Link>
                }
              />
            </CardContent>
          ) : (
            <CardContent className="px-0">
              {/* md+: table */}
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Validator</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">R*</TableHead>
                    <TableHead>ETA / รอบถัดไป</TableHead>
                    <TableHead>Compound ล่าสุด</TableHead>
                    <TableHead>ผลรอบล่าสุด</TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ p, hints }) => {
                    const href = `/positions/${p.id}`;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link href={href} className="font-medium underline-offset-2 hover:underline">
                            {p.wallet.label}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">{shortAddr(p.wallet.address)}</div>
                        </TableCell>
                        <TableCell>
                          <Link href={href} className="underline-offset-2 hover:underline">
                            {validatorLabel(p)}
                          </Link>
                          <div className="text-xs text-muted-foreground">#{p.validator.validatorId}</div>
                        </TableCell>
                        <TableCell className="max-w-56 whitespace-normal">{modeLabel(p)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Kub value={formatKub(p.principalWei)} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Kub value={formatKub(p.pendingWei)} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Kub value={p.principalWei > 0n ? formatKub(hints.rStarWei) : null} />
                        </TableCell>
                        <TableCell className="whitespace-normal tabular-nums">
                          <NextRun p={p} hints={hints} />
                        </TableCell>
                        <TableCell>
                          {p.lastCompoundAt ? (
                            <span title={formatDateTime(p.lastCompoundAt)}>{relativeTime(p.lastCompoundAt)}</span>
                          ) : (
                            <span className="text-muted-foreground">ยังไม่เคย</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-56 truncate" title={p.lastRunResult ?? undefined}>
                          {p.lastRunResult ?? <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          <Chips p={p} hints={hints} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* < md: stacked cards (same data) */}
              <ul className="divide-y divide-border md:hidden">
                {rows.map(({ p, hints }) => (
                  <li key={p.id}>
                    <Link
                      href={`/positions/${p.id}`}
                      className="block px-(--card-spacing) py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="font-medium break-words">
                            {p.wallet.label} <span className="font-normal text-muted-foreground">×</span> {validatorLabel(p)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono">{shortAddr(p.wallet.address)}</span> · #{p.validator.validatorId}
                          </div>
                        </div>
                        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </div>
                      <Chips p={p} hints={hints} className="mt-2" />
                      <KvList className="mt-2">
                        <KvRow label="Mode">
                          <span className="break-words">{modeLabel(p)}</span>
                        </KvRow>
                        <KvRow label="Principal">
                          <Kub value={formatKub(p.principalWei)} />
                        </KvRow>
                        <KvRow label="Pending">
                          <Kub value={formatKub(p.pendingWei)} />
                        </KvRow>
                        <KvRow label="ETA / รอบถัดไป">
                          <NextRun p={p} hints={hints} />
                        </KvRow>
                        <KvRow label="ผลรอบล่าสุด">
                          {p.lastRunResult ? (
                            <span className="line-clamp-2 break-words" title={p.lastRunResult}>
                              {p.lastRunResult}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </KvRow>
                      </KvList>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
