import "server-only";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getWorkerStatus, type WorkerStatusInfo } from "@/lib/worker";

async function loadStatus(): Promise<WorkerStatusInfo | "db_error"> {
  try {
    return await getWorkerStatus();
  } catch (err) {
    console.error(`[worker-status] ${err instanceof Error ? err.message : String(err)}`);
    return "db_error";
  }
}

/**
 * Header chip from `worker_heartbeat`: success when ticking (< 90 s), danger otherwise.
 * Responsive text (the header is tight): "worker" is screen-reader-only below `sm`; the last-tick time shows from `xl`
 * (always available in `title`).
 */
export async function WorkerStatus({ className }: { className?: string }) {
  const status = await loadStatus();

  if (status === "db_error") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <StatusBadge kind="danger" dot>
          ฐานข้อมูลไม่พร้อม
        </StatusBadge>
      </div>
    );
  }

  const { heartbeat, fresh } = status;
  const lastTick = heartbeat ? relativeTime(heartbeat.lastTickAt) : null;

  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 sm:gap-x-2", className)}>
      {fresh ? (
        <StatusBadge kind="success" dot title={heartbeat ? `tick ล่าสุด ${formatDateTime(heartbeat.lastTickAt)}` : undefined}>
          <span className="max-sm:sr-only">worker </span>
          ทำงาน
          <span className="hidden xl:inline"> ({lastTick})</span>
        </StatusBadge>
      ) : (
        <StatusBadge
          kind="danger"
          dot
          title={heartbeat ? `tick ล่าสุด ${formatDateTime(heartbeat.lastTickAt)}` : "ยังไม่มี heartbeat จาก worker"}
        >
          <span className="max-sm:sr-only">worker </span>
          ไม่ตอบสนอง
          {lastTick ? <span className="hidden xl:inline"> (ล่าสุด {lastTick})</span> : null}
        </StatusBadge>
      )}
    </div>
  );
}
