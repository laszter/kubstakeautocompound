import type { ValidatorRow } from "@kubstake/db";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<number, string> = { 0: "Uninit", 2: "Unstaked" };

/**
 * The ONE validator flag-chip set (validators page + position detail): inactive → danger, open/closed for delegation →
 * success/neutral, paused → warning, official pool / minimal set → outline. Server-safe.
 */
export function ValidatorStatusChips({
  validator: v,
  className,
}: {
  validator: Pick<ValidatorRow, "delegationEnabled" | "paused" | "isOfficialPool" | "status" | "inMinimalSet">;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {v.status !== 1 ? (
        <StatusBadge kind="danger">ไม่ active ({STATUS_LABEL[v.status] ?? `status ${v.status}`})</StatusBadge>
      ) : null}
      {v.delegationEnabled ? (
        <StatusBadge kind="success">เปิดรับ delegate</StatusBadge>
      ) : (
        <StatusBadge kind="neutral">ปิดรับ delegate</StatusBadge>
      )}
      {v.paused ? <StatusBadge kind="warning">paused</StatusBadge> : null}
      {v.isOfficialPool ? <StatusBadge kind="outline">official pool</StatusBadge> : null}
      {v.inMinimalSet ? <StatusBadge kind="outline">in minimal set</StatusBadge> : null}
    </div>
  );
}
