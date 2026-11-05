import "server-only";
import { workerHeartbeat, type WorkerHeartbeatRow } from "@kubstake/db";
import { eq } from "drizzle-orm";
import { getDb } from "./db";

/** Worker counts as alive if it ticked within 3 × the default 30 s tick interval. */
export const WORKER_FRESH_SEC = 90;

export type WorkerStatusInfo = {
  heartbeat: WorkerHeartbeatRow | null;
  /** seconds since `last_tick_at` (null when the worker never wrote a heartbeat) */
  ageSec: number | null;
  fresh: boolean;
};

export async function getHeartbeat(): Promise<WorkerHeartbeatRow | null> {
  const [row] = await getDb().select().from(workerHeartbeat).where(eq(workerHeartbeat.id, 1)).limit(1);
  return row ?? null;
}

export function heartbeatStatus(heartbeat: WorkerHeartbeatRow | null, now: Date = new Date()): WorkerStatusInfo {
  if (!heartbeat) return { heartbeat: null, ageSec: null, fresh: false };
  const ageSec = Math.max(0, Math.floor((now.getTime() - heartbeat.lastTickAt.getTime()) / 1000));
  return { heartbeat, ageSec, fresh: ageSec < WORKER_FRESH_SEC };
}

/** Heartbeat + freshness in one call (pages use `fresh` to disable action buttons when the worker is down). */
export async function getWorkerStatus(): Promise<WorkerStatusInfo> {
  return heartbeatStatus(await getHeartbeat());
}
