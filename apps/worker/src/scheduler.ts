import type { WorkerCtx } from "./context";
import { errMsg, sleep } from "./errors";
import { pulseHeartbeat, runTick, type TickReport } from "./tick";

// Tick loop = recursive setTimeout semantics: the next tick is scheduled only after the previous one has
// finished, so ticks never overlap. A light "pulse" keeps worker_heartbeat.last_tick_at fresh while a
// tick is legitimately long (e.g. waiting up to 180s for a receipt), but stops pulsing once a tick has
// been running for longer than `pulseMaxTickMs` so a hung worker shows up as stale.

export type LoopOptions = {
  signal: AbortSignal;
  /** checked before every tick (e.g. leader lock still held) */
  shouldContinue?: () => boolean;
  /** async gate before every tick (e.g. leader lock connection round-trip); false → stop the loop */
  beforeTick?: () => Promise<boolean>;
  pulseMaxTickMs?: number;
  tick?: (ctx: WorkerCtx) => Promise<TickReport>;
  pulse?: (ctx: WorkerCtx) => Promise<void>;
};

export async function startLoop(ctx: WorkerCtx, opts: LoopOptions): Promise<void> {
  const intervalMs = ctx.config.tickIntervalSec * 1000;
  const tick = opts.tick ?? runTick;
  const pulse = opts.pulse ?? pulseHeartbeat;
  const pulseMaxTickMs = opts.pulseMaxTickMs ?? 15 * 60_000;
  let tickStartedAt: number | null = null;

  const pulseTimer = setInterval(
    () => {
      if (tickStartedAt === null || Date.now() - tickStartedAt > pulseMaxTickMs) return;
      pulse(ctx).catch((err: unknown) => ctx.log.debug({ err: errMsg(err) }, "heartbeat pulse failed"));
    },
    Math.max(5000, Math.floor(intervalMs / 2)),
  );
  pulseTimer.unref();

  try {
    while (!opts.signal.aborted && (opts.shouldContinue?.() ?? true)) {
      const started = Date.now();
      if (opts.beforeTick && !(await opts.beforeTick())) break;
      tickStartedAt = started;
      try {
        const report = await tick(ctx);
        if (report.errors.length > 0) ctx.log.warn({ ...report }, "tick finished with errors");
        else if (report.actions > 0 || report.checked > 0) ctx.log.info({ ...report }, "tick");
      } catch (err) {
        ctx.log.error({ err: errMsg(err) }, "tick failed");
      } finally {
        tickStartedAt = null;
      }
      await sleep(Math.max(1000, intervalMs - (Date.now() - started)), opts.signal);
    }
  } finally {
    clearInterval(pulseTimer);
  }
}
