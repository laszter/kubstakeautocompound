import type { ReactNode } from "react";
import type { ActionRow, TxRow } from "@kubstake/db";
import { StatusBadge, type StatusKind } from "@/components/status-badge";
import { cn } from "@/lib/utils";

// Small status chips shared by the position detail page and the dashboard (server-rendered).
// Colours come from <StatusBadge kind=…/> only (one colour per meaning — TASK §4).

export const ACTION_TYPE_LABELS: Record<ActionRow["type"], string> = {
  delegate: "Delegate",
  undelegate: "Undelegate (ถอน)",
  claim: "Claim reward",
  compound: "Compound",
  sync_validators: "ซิงก์ validators",
};

export const TX_KIND_LABELS: Record<TxRow["kind"], string> = {
  delegate: "delegate",
  undelegate: "undelegate",
  claim: "claim",
  compound_delegate: "compound (delegate)",
  compound_claim: "compound (claim)",
};

const ACTION_STATUS: Record<ActionRow["status"], { label: string; kind: StatusKind }> = {
  pending: { label: "รอคิว", kind: "neutral" },
  running: { label: "กำลังทำ", kind: "info" },
  done: { label: "สำเร็จ", kind: "success" },
  failed: { label: "ล้มเหลว", kind: "danger" },
  skipped: { label: "ข้าม", kind: "outline" },
};

export function ActionStatusBadge({ status }: { status: ActionRow["status"] }) {
  const s = ACTION_STATUS[status];
  return <StatusBadge kind={s.kind}>{s.label}</StatusBadge>;
}

const TX_STATUS: Record<TxRow["status"], { label: string; kind: StatusKind }> = {
  signed: { label: "เซ็นแล้ว", kind: "neutral" },
  broadcast: { label: "ส่งแล้ว รอ receipt", kind: "info" },
  confirmed: { label: "ยืนยันแล้ว", kind: "success" },
  reverted: { label: "reverted", kind: "danger" },
  failed: { label: "ล้มเหลว", kind: "danger" },
};

export function TxStatusBadge({ status }: { status: TxRow["status"] }) {
  const s = TX_STATUS[status];
  return <StatusBadge kind={s.kind}>{s.label}</StatusBadge>;
}

export function WarnBadge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <StatusBadge kind="warning" title={title}>
      {children}
    </StatusBadge>
  );
}

/** Dashboard / header chips for a position: disabled, claim-only, backoff. */
export function PositionStatusChips({
  enabled,
  claimOnly,
  backoffUntil,
  className,
}: {
  enabled: boolean;
  claimOnly: boolean;
  backoffUntil: string | null;
  className?: string;
}) {
  const none = enabled && !claimOnly && !backoffUntil;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {!enabled ? <StatusBadge kind="neutral">ปิด auto-compound</StatusBadge> : null}
      {claimOnly ? <StatusBadge kind="danger">claim-only</StatusBadge> : null}
      {backoffUntil ? <WarnBadge title={`พักถึง ${backoffUntil}`}>backoff</WarnBadge> : null}
      {none ? <StatusBadge kind="success">auto</StatusBadge> : null}
    </div>
  );
}
