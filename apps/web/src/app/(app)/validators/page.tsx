import { actions, validators, type ValidatorRow } from "@kubstake/db";
import { asc, desc, eq } from "drizzle-orm";
import { LayoutGridIcon, ListIcon, LoaderCircleIcon, ServerIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { Kub } from "@/components/kub";
import { KvList, KvRow } from "@/components/kv";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ValidatorStatusChips } from "@/components/validator-status-chips";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addressUrl, formatDateTime, formatKub, relativeTime, shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getWorkerStatus, type WorkerStatusInfo } from "@/lib/worker";
import { RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Validators · KUB Stake Auto-Compound" };

type LastSync = { status: string; createdAt: Date; finishedAt: Date | null; error: string | null };

async function load(): Promise<{
  rows: ValidatorRow[];
  lastSync: LastSync | null;
  worker: WorkerStatusInfo | null;
  error: string | null;
}> {
  try {
    const db = getDb();
    const [rows, syncRows, worker] = await Promise.all([
      db.select().from(validators).orderBy(desc(validators.delegatedWei), asc(validators.validatorId)),
      db
        .select({ status: actions.status, createdAt: actions.createdAt, finishedAt: actions.finishedAt, error: actions.error })
        .from(actions)
        .where(eq(actions.type, "sync_validators"))
        .orderBy(desc(actions.createdAt))
        .limit(1),
      getWorkerStatus().catch(() => null),
    ]);
    return { rows, lastSync: syncRows[0] ?? null, worker, error: null };
  } catch (err) {
    console.error(`[validators] load failed: ${err instanceof Error ? err.message : String(err)}`);
    return { rows: [], lastSync: null, worker: null, error: "อ่านรายชื่อ validator จากฐานข้อมูลไม่สำเร็จ" };
  }
}

const STATUS_LABEL: Record<number, string> = { 0: "Uninit", 1: "Active", 2: "Unstaked" };

/** Same rule as the worker/position form: new delegations only to active, open, unpaused, non-official-pool validators. */
function delegateBlockers(v: ValidatorRow): string[] {
  const reasons: string[] = [];
  if (v.status !== 1) reasons.push(`validator ไม่ active (${STATUS_LABEL[v.status] ?? `status ${v.status}`})`);
  if (!v.delegationEnabled) reasons.push("ปิดรับ delegate");
  if (v.paused) reasons.push("paused");
  if (v.isOfficialPool) reasons.push("official pool");
  return reasons;
}

function formatCommission(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}


type View = "grid" | "list";

function DelegateButton({ v, layout }: { v: ValidatorRow; layout: View }) {
  const blockers = delegateBlockers(v);
  const grid = layout === "grid";
  const size = grid ? "default" : "sm";
  if (blockers.length > 0) {
    return (
      <span title={`delegate ใหม่ไม่ได้: ${blockers.join(", ")}`} className={grid ? "flex w-full" : "inline-flex"}>
        <Button size={size} variant="outline" disabled className={grid ? "w-full" : undefined}>
          Delegate
        </Button>
      </span>
    );
  }
  // prefetch off: one link per validator, and <AutoRefresh/> would re-prefetch all of them every 15 s
  return (
    <Link
      href={`/positions/new?validatorId=${v.validatorId}`}
      prefetch={false}
      className={cn(buttonVariants({ variant: "outline-primary", size }), grid && "w-full")}
    >
      Delegate
      <span className="sr-only"> {v.name ?? `#${v.validatorId}`}</span>
    </Link>
  );
}

function ShareAddressLink({ address, className }: { address: string; className?: string }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-mono text-xs underline-offset-4 hover:underline", className)}
      title={address}
    >
      {shortAddr(address)}
    </a>
  );
}

const VIEW_OPTIONS = [
  { view: "grid", label: "มุมมองการ์ด", Icon: LayoutGridIcon },
  { view: "list", label: "มุมมองตาราง", Icon: ListIcon },
] as const;

/** Grid / list switch = plain links to `?view=…` (server-rendered, no client state). Tables only exist ≥ md, so hidden below. */
function ViewToggle({ current }: { current: View }) {
  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="h-6 w-px bg-border" aria-hidden />
      <div role="group" aria-label="มุมมองรายชื่อ" className="flex items-center gap-1">
        {VIEW_OPTIONS.map(({ view, label, Icon }) => {
          const active = view === current;
          return (
            <Link
              key={view}
              href={{ pathname: "/validators", query: { view } }}
              prefetch={false}
              scroll={false}
              aria-current={active ? "true" : undefined}
              title={label}
              className={cn(
                buttonVariants({ variant: "outline", size: "icon-sm" }),
                active && "border-primary bg-primary/10 text-primary hover:bg-primary/10",
              )}
            >
              <Icon aria-hidden />
              <span className="sr-only">{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ValidatorTile({ v }: { v: ValidatorRow }) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <span
          className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground tabular-nums"
          aria-hidden={v.name ? undefined : true}
        >
          #{v.validatorId}
        </span>
        <div className="w-full truncate font-semibold" title={v.name ?? undefined}>
          {v.name ?? <span className="text-muted-foreground">#{v.validatorId}</span>}
        </div>
        <ShareAddressLink address={v.shareAddress} className="text-muted-foreground hover:text-foreground" />
      </div>
      <ValidatorStatusChips validator={v} className="justify-center" />
      <KvList>
        <KvRow label="Delegated">
          <Kub value={formatKub(v.delegatedWei, 2)} />
        </KvRow>
        <KvRow label="Commission">{formatCommission(v.commissionBps)}</KvRow>
        <KvRow label="Min delegate">
          <Kub value={formatKub(v.minDelegatedWei)} />
        </KvRow>
      </KvList>
      <div className="mt-auto pt-1">
        <DelegateButton v={v} layout="grid" />
      </div>
    </li>
  );
}

function ValidatorGrid({ rows }: { rows: ValidatorRow[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4 md:gap-6">
      {rows.map((v) => (
        <ValidatorTile key={v.validatorId} v={v} />
      ))}
    </ul>
  );
}

function ValidatorTable({ rows }: { rows: ValidatorRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">ID</TableHead>
          <TableHead>ชื่อ</TableHead>
          <TableHead>Share contract</TableHead>
          <TableHead className="text-right">Commission</TableHead>
          <TableHead className="text-right">Delegated</TableHead>
          <TableHead className="text-right">Min delegate</TableHead>
          <TableHead>สถานะ</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Delegate</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <TableRow key={v.validatorId}>
            <TableCell className="text-right text-muted-foreground tabular-nums">{v.validatorId}</TableCell>
            <TableCell className="max-w-48 truncate font-medium" title={v.name ?? undefined}>
              {v.name ?? <span className="text-muted-foreground">#{v.validatorId}</span>}
            </TableCell>
            <TableCell>
              <ShareAddressLink address={v.shareAddress} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCommission(v.commissionBps)}</TableCell>
            <TableCell className="text-right">
              <Kub value={formatKub(v.delegatedWei, 2)} />
            </TableCell>
            <TableCell className="text-right">
              <Kub value={formatKub(v.minDelegatedWei)} />
            </TableCell>
            <TableCell>
              <ValidatorStatusChips validator={v} />
            </TableCell>
            <TableCell className="text-right">
              <DelegateButton v={v} layout="list" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function ValidatorsPage(props: PageProps<"/validators">) {
  await requireSession();
  const view: View = (await props.searchParams).view === "list" ? "list" : "grid";
  const { rows, lastSync, worker, error } = await load();

  const syncing = lastSync !== null && (lastSync.status === "pending" || lastSync.status === "running");
  const lastSyncFailed = lastSync !== null && lastSync.status === "failed";
  const syncedAt = rows.reduce<Date | null>((max, v) => (max === null || v.syncedAt > max ? v.syncedAt : max), null);
  const delegatable = rows.filter((v) => delegateBlockers(v).length === 0).length;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />
      <PageHeader
        title="Validators"
        description="รายชื่อ validator บน KUB Chain (mainnet) ที่ worker ซิงก์จาก StakeManager — เรียงตามยอด delegate มากไปน้อย"
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>ฐานข้อมูลไม่พร้อม</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        {/* flex (not the CardAction grid) so the actions drop below the sync status on phones instead of squeezing it */}
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              รายชื่อ validator
              {rows.length > 0 ? <Badge className="tabular-nums">{rows.length}</Badge> : null}
              {syncing ? (
                <StatusBadge kind="info">
                  <LoaderCircleIcon className="animate-spin" aria-hidden />
                  กำลังซิงก์...
                </StatusBadge>
              ) : null}
            </CardTitle>
            <CardDescription className="flex flex-col gap-0.5">
              <span>
                {syncedAt ? (
                  <>
                    ซิงก์ล่าสุด <span title={formatDateTime(syncedAt)}>{relativeTime(syncedAt)}</span> ({formatDateTime(syncedAt)})
                  </>
                ) : (
                  "ยังไม่เคยซิงก์"
                )}
                {rows.length > 0 ? ` · ทั้งหมด ${rows.length} ตัว · delegate ใหม่ได้ ${delegatable} ตัว` : ""}
              </span>
              {lastSyncFailed ? (
                <span className="text-destructive">
                  ซิงก์ครั้งล่าสุดล้มเหลว ({formatDateTime(lastSync.finishedAt ?? lastSync.createdAt)})
                  {lastSync.error ? `: ${lastSync.error}` : ""}
                </span>
              ) : null}
              {syncing && worker && !worker.fresh ? (
                <span className="text-destructive">worker ไม่ตอบสนอง — คำสั่งซิงก์จะรอจนกว่า worker กลับมาทำงาน</span>
              ) : null}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <RefreshButton syncing={syncing} />
            {rows.length > 0 ? <ViewToggle current={view} /> : null}
          </div>
        </CardHeader>

        {rows.length > 0 ? (
          view === "list" ? (
            <>
              <CardContent className="hidden px-0 md:block">
                <ValidatorTable rows={rows} />
              </CardContent>
              {/* list view = table ≥ md only; phones keep the card grid */}
              <CardContent className="md:hidden">
                <ValidatorGrid rows={rows} />
              </CardContent>
            </>
          ) : (
            <CardContent>
              <ValidatorGrid rows={rows} />
            </CardContent>
          )
        ) : !error ? (
          <CardContent>
            <EmptyState
              icon={ServerIcon}
              title="ยังไม่มีรายชื่อ validator ในฐานข้อมูล"
              description={<>worker จะซิงก์จาก chain ให้เองเมื่อเริ่มทำงาน หรือกด &quot;รีเฟรชรายชื่อ&quot;</>}
            />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
