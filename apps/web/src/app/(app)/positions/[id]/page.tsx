import { describeCron } from "@kubstake/core/browser";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Kub } from "@/components/kub";
import { KvList } from "@/components/kv";
import { PageHeader } from "@/components/page-header";
import { StatsStrip } from "@/components/stats-strip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ValidatorStatusChips } from "@/components/validator-status-chips";
import { DryRunBadge } from "@/components/worker-status";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  addressUrl,
  formatDateTime,
  formatDuration,
  formatGwei,
  formatKub,
  relativeTime,
  shortAddr,
  txUrl,
} from "@/lib/format";
import { getWorkerStatus, type WorkerStatusInfo } from "@/lib/worker";
import {
  ACTION_TYPE_LABELS,
  ActionStatusBadge,
  PositionStatusChips,
  TX_KIND_LABELS,
  TxStatusBadge,
} from "../_components/badges";
import {
  computePositionHints,
  DECISION_REASON_LABELS,
  DEFAULT_HINT_SETTINGS,
  formatApr,
  isValidatorDelegatable,
  maxDelegatableWei,
  PATH_LABELS,
  WEI_PER_KUB,
} from "../_lib/hints";
import { isUuid, positionToSettingsValues } from "../_lib/position-fields";
import { loadPositionDetail } from "../_lib/queries";
import { ActionButtons } from "./action-buttons";
import { DelegateForm } from "./delegate-form";
import { DeletePositionButton } from "./delete-position-button";
import { EnabledSwitch } from "./enabled-switch";
import { PositionSettingsForm } from "./position-settings-form";
import { UndelegateForm } from "./undelegate-form";

export const metadata: Metadata = { title: "Position · KUB Stake Auto-Compound" };

type Detail = NonNullable<Awaited<ReturnType<typeof loadPositionDetail>>>;

async function load(id: string): Promise<{ data: Detail | null; worker: WorkerStatusInfo } | "db_error"> {
  try {
    const [data, worker] = await Promise.all([loadPositionDetail(id), getWorkerStatus()]);
    return { data, worker };
  } catch (err) {
    console.error(`[positions:detail] ${err instanceof Error ? err.message : String(err)}`);
    return "db_error";
  }
}

function etaLabel(sec: number, hasPrincipal = true): string {
  if (!hasPrincipal) return "- (ยังไม่มีเงินต้น)";
  if (sec <= 0) return "ถึงแล้ว";
  if (!Number.isFinite(sec)) return "ไม่มีกำหนด";
  return `≈ ${formatDuration(sec)}`;
}

function when(d: Date | null, empty = "-"): string {
  return d ? `${formatDateTime(d)} (${relativeTime(d)})` : empty;
}

/** Detail key/value row (inside <KvList>): label column left, free-form value (wraps) — stacked below sm. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
      <dt className="w-36 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-muted-foreground py-6 text-center">
        {children}
      </TableCell>
    </TableRow>
  );
}

export default async function PositionDetailPage(props: PageProps<"/positions/[id]">) {
  await requireSession();
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!isUuid(id)) notFound();

  const loaded = await load(id);
  if (loaded === "db_error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>ฐานข้อมูลไม่พร้อม</AlertTitle>
        <AlertDescription>อ่านข้อมูล position ไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</AlertDescription>
      </Alert>
    );
  }
  const { data, worker } = loaded;
  if (!data) notFound();

  const { position: p, settings, openTypes, recentActions, recentTxs, snapshots } = data;
  const v = p.validator;
  const w = p.wallet;
  const s = settings ?? DEFAULT_HINT_SETTINGS;
  const hints = computePositionHints({
    position: p,
    validator: v,
    walletBalanceWei: w.balanceWei,
    settings: s,
    gasPriceWei: worker.heartbeat?.gasPriceWei ?? null,
    now: new Date(),
  });
  const delegatable = isValidatorDelegatable(v);
  const claimOnlyAlert = hints.claimOnly || !delegatable;
  const hasPrincipal = p.principalWei > 0n;
  const validatorName = v.name ?? `Validator #${v.validatorId}`;
  const dryRun = worker.dryRun === true;

  // Button guards (the server actions re-check worker freshness + open actions).
  const workerReason = worker.fresh ? null : "worker ไม่ตอบสนอง — ยังสั่งงานไม่ได้";
  const pendingReason = (t: "delegate" | "undelegate" | "claim" | "compound") =>
    openTypes.has(t) ? "มีคำสั่งค้างอยู่แล้ว — รอ worker ดำเนินการ" : null;
  const delegateReason = workerReason ?? pendingReason("delegate") ?? (delegatable ? null : "validator ปิดรับ delegate — ถอน/claim ได้อย่างเดียว");
  const undelegateReason = workerReason ?? pendingReason("undelegate") ?? (hasPrincipal ? null : "ยังไม่มีเงินต้นให้ถอน");
  const nothingToClaim = p.chainSyncedAt !== null && !hasPrincipal && p.pendingWei === 0n;
  const claimReason = workerReason ?? pendingReason("claim") ?? (nothingToClaim ? "ยังไม่มี reward ค้าง" : null);
  const compoundReason = workerReason ?? pendingReason("compound") ?? (hasPrincipal ? null : "ยังไม่มีเงินต้น — delegate ก่อน");
  const deleteReason =
    p.principalWei !== 0n || p.pendingWei !== 0n
      ? "ลบได้เมื่อเงินต้นและ reward ค้างเป็น 0 — ถอนทั้งหมดก่อน"
      : openTypes.size > 0
        ? "มีคำสั่งค้างอยู่ — รอ worker ทำให้เสร็จก่อน"
        : null;

  const maxDelegate = maxDelegatableWei(w.balanceWei, s.gasReserveWei, hints.gasPriceWei);
  const defaultThresholdKub = hints.optimalTargetWei >= WEI_PER_KUB / 100n ? formatKub(hints.optimalTargetWei, 2) : "1";

  const modeSummary =
    p.strategy === "threshold" && p.thresholdWei !== null
      ? `Threshold — compound เมื่อ reward ≥ ${formatKub(p.thresholdWei)} KUB`
      : p.strategy === "schedule" && p.cronExpr
        ? `Schedule — ${describeCron(p.cronExpr)} (${p.cronExpr})`
        : `Optimal — compound เมื่อ reward ≥ ${formatKub(hints.optimalTargetWei)} KUB`;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />

      <PageHeader
        backHref="/"
        backLabel="แดชบอร์ด"
        title={
          <>
            {w.label} <span className="font-normal text-muted-foreground">×</span> {validatorName}
          </>
        }
        description={
          <div className="flex flex-col gap-2">
            <p>
              wallet{" "}
              <a
                href={addressUrl(w.address)}
                target="_blank"
                rel="noreferrer"
                className="font-mono whitespace-nowrap underline-offset-2 hover:text-foreground hover:underline"
              >
                {shortAddr(w.address)}
              </a>{" "}
              · validator #{v.validatorId} · share{" "}
              <a
                href={addressUrl(v.shareAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono whitespace-nowrap underline-offset-2 hover:text-foreground hover:underline"
              >
                {shortAddr(v.shareAddress)}
              </a>{" "}
              · commission {(v.commissionBps / 100).toLocaleString("en-US")}% · minDelegated {formatKub(v.minDelegatedWei)} KUB
            </p>
            <ValidatorStatusChips validator={v} />
          </div>
        }
        actions={
          <>
            {dryRun ? <DryRunBadge /> : null}
            <PositionStatusChips
              enabled={p.enabled}
              claimOnly={claimOnlyAlert}
              backoffUntil={hints.backoffUntil ? formatDateTime(hints.backoffUntil) : null}
            />
          </>
        }
      />

      {sp.created === "1" ? (
        <Alert variant="success">
          <CircleCheckIcon />
          <AlertDescription>
            สร้าง position แล้ว{sp.delegate === "1" ? " และส่งคำสั่ง delegate ให้ worker แล้ว (ดูสถานะในประวัติคำสั่ง)" : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      {sp.exists === "1" ? (
        <Alert variant="info">
          <InfoIcon />
          <AlertDescription>มี position ของ wallet × validator นี้อยู่แล้ว — แสดงหน้าเดิม (ใช้ฟอร์ม delegate ด้านล่างเพื่อเพิ่มเงิน)</AlertDescription>
        </Alert>
      ) : null}

      {claimOnlyAlert ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>claim-only</AlertTitle>
          <AlertDescription>validator ปิดรับ delegate — ระบบจะ claim อย่างเดียว ถอนได้ปกติ</AlertDescription>
        </Alert>
      ) : null}

      <StatsStrip
        items={[
          { label: "เงินต้น (principal)", value: <Kub value={formatKub(p.principalWei)} /> },
          { label: "Reward ค้าง", value: <Kub value={formatKub(p.pendingWei)} /> },
          {
            label: "KUB ใน wallet",
            value: <Kub value={hints.liquidWei !== null ? formatKub(hints.liquidWei) : null} placeholder="รอ worker" />,
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>สถานะ</CardTitle>
            <CardDescription>
              {p.chainSyncedAt ? `ข้อมูลจาก chain ล่าสุด ${when(p.chainSyncedAt)}` : "รอ worker อ่านข้อมูลจาก chain ครั้งแรก"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <KvList>
              <Row label="APR (ประมาณ)">
                {formatApr(hints.apr)}{" "}
                <span className="text-muted-foreground text-xs">{hints.aprIsDefault ? "(ค่าเริ่มต้น — ยังไม่มี sample)" : "(EWMA จากการวัดจริง)"}</span>
              </Row>
              <Row label="Reward ที่คุ้มค่า gas ที่สุด (R*)">
                {hasPrincipal ? (
                  <>
                    <Kub value={formatKub(hints.rStarWei)} />{" "}
                    <span className="text-muted-foreground text-xs">
                      = √(2·C·P), C ≈ {formatKub(hints.costWei, 6)} KUB/รอบ ({PATH_LABELS[hints.path]}) @ {formatGwei(hints.gasPriceWei)} gwei
                      {hints.gasPriceIsFallback ? " (ประมาณ — ยังไม่มีค่าจาก worker)" : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">ยังไม่มีเงินต้น</span>
                )}
              </Row>
              <Row label="ETA ถึงเกณฑ์">
                {!hasPrincipal ? (
                  <span className="text-muted-foreground">ยังไม่มีเงินต้น</span>
                ) : p.strategy === "schedule" ? (
                  <>
                    ถึง R* {etaLabel(hints.optimalEtaSec)}{" "}
                    <span className="text-muted-foreground text-xs">(โหมด schedule ทำงานตามเวลา)</span>
                  </>
                ) : (
                  <>
                    {etaLabel(hints.activeEtaSec)}{" "}
                    <span className="text-muted-foreground text-xs">(ถึง {formatKub(hints.activeTargetWei)} KUB · t* {etaLabel(hints.tStarSec)})</span>
                  </>
                )}
              </Row>
              <Row label="โหมด">
                {modeSummary}
                {!p.enabled ? <span className="text-muted-foreground"> · ปิดอยู่</span> : null}
              </Row>
              <Row label="ประเมินตอนนี้">
                {DECISION_REASON_LABELS[hints.decision.reason]}{" "}
                <span className="text-muted-foreground text-xs">(ประมาณจากข้อมูลล่าสุด — worker ตัดสินจริงตอนตรวจ)</span>
              </Row>
              <Row label="ตรวจครั้งถัดไป">{when(p.nextCheckAt)}</Row>
              {p.strategy === "schedule" ? <Row label="รันครั้งถัดไป">{when(p.nextRunAt, "รอ worker คำนวณ")}</Row> : null}
              <Row label="ผลรอบล่าสุด">
                {p.lastRunResult ? (
                  <>
                    {p.lastRunResult}
                    {p.lastRunAt ? <span className="text-muted-foreground text-xs"> · {when(p.lastRunAt)}</span> : null}
                  </>
                ) : (
                  "-"
                )}
              </Row>
              <Row label="Compound ล่าสุด">{when(p.lastCompoundAt, "ยังไม่เคย")}</Row>
              <Row label="ตรวจล่าสุด">{when(p.lastCheckAt, "ยังไม่เคย")}</Row>
              {p.lastError || p.backoffLevel > 0 ? (
                <Row label="Error ล่าสุด">
                  <span className="text-destructive">{p.lastError ?? "-"}</span>
                  {p.backoffLevel > 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · backoff ระดับ {p.backoffLevel}
                      {hints.backoffUntil ? ` (พักถึง ${formatDateTime(hints.backoffUntil)})` : ""}
                    </span>
                  ) : null}
                </Row>
              ) : null}
            </KvList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">สั่งงาน {dryRun ? <DryRunBadge /> : null}</CardTitle>
            <CardDescription>
              ปุ่มเหล่านี้แค่ส่งคำสั่งเข้าคิว — worker เป็นผู้ simulate/เซ็น/ส่ง tx (ไม่ติด max gas price และ min interval แต่ยังกัน gas
              reserve)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!worker.fresh ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>worker ไม่ตอบสนอง — ปุ่มสั่งงานถูกปิดไว้จนกว่า worker จะกลับมาทำงาน</AlertDescription>
              </Alert>
            ) : null}
            <DelegateForm
              positionId={p.id}
              disabledReason={delegateReason}
              maxKub={maxDelegate !== null ? formatKub(maxDelegate, 18) : null}
              maxLabel={maxDelegate !== null ? formatKub(maxDelegate) : null}
              minFirstLabel={hasPrincipal ? null : formatKub(v.minDelegatedWei, 18)}
              reserveLabel={formatKub(s.gasReserveWei)}
            />
            <Separator />
            <UndelegateForm
              positionId={p.id}
              disabledReason={undelegateReason}
              principalWei={p.principalWei.toString()}
              minDelegatedWei={v.minDelegatedWei.toString()}
              principalLabel={formatKub(p.principalWei, 18)}
              minDelegatedLabel={formatKub(v.minDelegatedWei, 18)}
              pendingLabel={formatKub(p.pendingWei)}
            />
            <Separator />
            <ActionButtons
              positionId={p.id}
              claimDisabledReason={claimReason}
              compoundDisabledReason={compoundReason}
              pendingLabel={formatKub(p.pendingWei)}
              costLabel={formatKub(hints.costWei, 6)}
              pathLabel={PATH_LABELS[hints.path]}
              dryRun={dryRun}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        {/* flex (not the CardAction grid) so the switch drops below the description on phones instead of squeezing the title */}
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle>ตั้งค่า auto-compound</CardTitle>
            <CardDescription>
              ใช้งานอยู่: {modeSummary}
              {p.strategy === "schedule" && p.minRewardWei !== null ? ` · reward ขั้นต่ำ ${formatKub(p.minRewardWei)} KUB` : ""}
              {p.strategy === "schedule" && p.nextRunAt ? ` · รอบถัดไป ${formatDateTime(p.nextRunAt)}` : ""}
            </CardDescription>
          </div>
          <div className="self-start sm:shrink-0">
            <EnabledSwitch positionId={p.id} enabled={p.enabled} />
          </div>
        </CardHeader>
        <CardContent>
          <PositionSettingsForm
            positionId={p.id}
            timeZone={env.APP_TIMEZONE}
            initial={positionToSettingsValues(p, defaultThresholdKub)}
            hints={{
              hasPrincipal,
              rStarLabel: formatKub(hints.rStarWei),
              optimalTargetLabel: formatKub(hints.optimalTargetWei),
              optimalEtaLabel: etaLabel(hints.optimalEtaSec, hasPrincipal),
              rFloorLabel: formatKub(s.rFloorWei),
              costLabel: formatKub(hints.costWei, 6),
              defaultMinRewardLabel: formatKub(hints.defaultMinRewardWei, 6),
              aprLabel: formatApr(hints.apr),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>ประวัติคำสั่ง</CardTitle>
          <CardDescription>20 รายการล่าสุด (pending → running → done / failed / skipped)</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>คำสั่ง</TableHead>
                <TableHead className="text-right">จำนวน</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>สั่งโดย</TableHead>
                <TableHead>รายละเอียด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentActions.length === 0 ? (
                <EmptyRow cols={6}>ยังไม่มีคำสั่ง</EmptyRow>
              ) : (
                recentActions.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="tabular-nums">{formatDateTime(a.createdAt)}</TableCell>
                    <TableCell>{ACTION_TYPE_LABELS[a.type]}</TableCell>
                    <TableCell className="text-right">
                      <Kub value={a.amountWei !== null ? formatKub(a.amountWei) : null} />
                    </TableCell>
                    <TableCell>
                      <ActionStatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.requestedBy === "engine" ? "engine" : "UI"}</TableCell>
                    <TableCell className="min-w-64 max-w-md truncate whitespace-normal" title={a.error ?? undefined}>
                      {a.error ? <span className={a.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{a.error}</span> : null}
                      {a.finishedAt ? <span className="text-muted-foreground text-xs"> · เสร็จ {formatDateTime(a.finishedAt)}</span> : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>ประวัติ transaction</CardTitle>
          <CardDescription>30 รายการล่าสุด · จำนวนจาก event ของ validator share (Delegated / Undelegated / ClaimedRewards)</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>ชนิด</TableHead>
                <TableHead>Tx hash</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Claimed</TableHead>
                <TableHead className="text-right">Delegated / Undelegated</TableHead>
                <TableHead className="text-right">Gas used (ค่า gas)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTxs.length === 0 ? (
                <EmptyRow cols={8}>ยังไม่มี transaction{dryRun ? " (DRY RUN ไม่บันทึก tx)" : ""}</EmptyRow>
              ) : (
                recentTxs.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums">{formatDateTime(t.confirmedAt ?? t.broadcastAt ?? t.createdAt)}</TableCell>
                    <TableCell>{TX_KIND_LABELS[t.kind]}</TableCell>
                    <TableCell>
                      <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="font-mono text-xs underline-offset-2 hover:underline">
                        {shortAddr(t.hash)}
                      </a>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <TxStatusBadge status={t.status} />
                        {t.error ? <span className="text-destructive max-w-48 truncate text-xs" title={t.error}>{t.error}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Kub value={formatKub(t.valueWei)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Kub value={t.eventClaimedWei !== null ? formatKub(t.eventClaimedWei) : null} />
                    </TableCell>
                    <TableCell className="text-right">
                      {t.eventDelegatedWei !== null ? (
                        <span>
                          +<Kub value={formatKub(t.eventDelegatedWei)} />
                        </span>
                      ) : t.eventUndelegatedWei !== null ? (
                        <span>
                          −<Kub value={formatKub(t.eventUndelegatedWei)} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.gasUsed !== null ? (
                        <>
                          {t.gasUsed.toLocaleString("en-US")}{" "}
                          <span className="text-muted-foreground text-xs">({formatKub(t.gasUsed * t.gasPriceWei, 6)} KUB)</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Snapshots</CardTitle>
          <CardDescription>30 ครั้งล่าสุดที่ worker ตรวจ position นี้</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">APR</TableHead>
                <TableHead className="text-right">R*</TableHead>
                <TableHead className="text-right">Gas price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.length === 0 ? (
                <EmptyRow cols={6}>ยังไม่มี snapshot</EmptyRow>
              ) : (
                snapshots.map((sn) => (
                  <TableRow key={sn.id}>
                    <TableCell className="tabular-nums">{formatDateTime(sn.takenAt)}</TableCell>
                    <TableCell className="text-right">
                      <Kub value={formatKub(sn.principalWei)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Kub value={formatKub(sn.pendingWei, 6)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{sn.aprEst !== null ? formatApr(sn.aprEst) : "-"}</TableCell>
                    <TableCell className="text-right">
                      <Kub value={sn.rStarWei !== null ? formatKub(sn.rStarWei) : null} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatGwei(sn.gasPriceWei)} gwei</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader className="border-b border-destructive/20">
          <CardTitle className="text-destructive">ลบ position</CardTitle>
          <CardDescription>ลบได้เฉพาะเมื่อ principal = 0 และ pending = 0</CardDescription>
        </CardHeader>
        <CardContent>
          <DeletePositionButton positionId={p.id} disabledReason={deleteReason} />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        <Badge variant="outline">id</Badge> <span className="font-mono break-all">{p.id}</span> · อัปเดตอัตโนมัติทุก 15 วินาที
      </p>
    </div>
  );
}
