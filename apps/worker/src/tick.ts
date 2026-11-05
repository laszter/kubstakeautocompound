import { eq, lt, sql } from "drizzle-orm";
import { CHAIN_ID } from "@kubstake/core";
import { getSettings, positionSnapshots, workerHeartbeat } from "@kubstake/db";
import type { TickInputs, WorkerCtx } from "./context";
import { checkPosition } from "./engine";
import { errMsg } from "./errors";
import { processActions, recoverStaleActions } from "./executor";
import { loadDuePositions } from "./queries";
import { maybeSyncValidators } from "./validatorSync";
import { refreshWalletBalances } from "./wallets";

// One tick: heartbeat → recover in-flight txs (+ close stale 'running' actions) → action queue →
// validator sync (when stale) → wallet balances → due positions (≤ 20) → daily snapshot prune.
// Every step is isolated: an error is logged, collected into worker_heartbeat.last_error, and the next
// step still runs.

export const MAX_POSITIONS_PER_TICK = 20;
const SNAPSHOT_RETENTION_DAYS = 90;
/** After a position check throws (RPC error, ...), retry it after this delay instead of every tick. */
const CHECK_ERROR_RETRY_MS = 120_000;

export type TickReport = { errors: string[]; actions: number; checked: number; durationMs: number };

const clip = (s: string, max = 1000) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export async function runTick(ctx: WorkerCtx): Promise<TickReport> {
  const started = Date.now();
  const errors: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (ctx.shouldStop()) return undefined;
    try {
      return await fn();
    } catch (err) {
      errors.push(`${name}: ${errMsg(err, 200)}`);
      ctx.log.error({ step: name, err: errMsg(err) }, "tick step failed");
      return undefined;
    }
  };

  const chain = await step("chain", async () => {
    const blockNumber = await ctx.chain.getBlockNumber();
    const gasPriceWei = await ctx.chain.getGasPrice();
    return { blockNumber, gasPriceWei };
  });
  await step("heartbeat", () => writeHeartbeat(ctx, chain));
  const settings = await step("settings", () => getSettings(ctx.db));
  await step("recover", () => ctx.txManager.recoverInFlight());
  await step("stale_actions", () => recoverStaleActions(ctx));

  const inputs: TickInputs | undefined = settings ? { settings, gasPriceWei: chain?.gasPriceWei } : undefined;
  const actions = inputs ? ((await step("actions", () => processActions(ctx, inputs))) ?? 0) : 0;
  if (settings) await step("validators", () => maybeSyncValidators(ctx, settings));
  await step("wallets", () => refreshWalletBalances(ctx));
  const checked = inputs ? ((await step("positions", () => checkDuePositions(ctx, inputs, errors))) ?? 0) : 0;
  await step("prune", () => pruneSnapshots(ctx));

  if (!ctx.shouldStop()) {
    await ctx.db
      .update(workerHeartbeat)
      .set({ lastError: errors.length > 0 ? clip(errors.join(" | ")) : null })
      .where(eq(workerHeartbeat.id, 1))
      .catch((err: unknown) => ctx.log.warn({ err: errMsg(err) }, "could not write heartbeat last_error"));
  }
  const report: TickReport = { errors, actions, checked, durationMs: Date.now() - started };
  ctx.log.debug(report, "tick done");
  return report;
}

async function writeHeartbeat(ctx: WorkerCtx, chain: { blockNumber: bigint; gasPriceWei: bigint } | undefined): Promise<void> {
  const now = ctx.now();
  await ctx.db
    .insert(workerHeartbeat)
    .values({
      id: 1,
      instanceId: ctx.instanceId,
      startedAt: ctx.startedAt,
      lastTickAt: now,
      tickCount: 1n,
      chainId: CHAIN_ID,
      blockNumber: chain?.blockNumber ?? null,
      gasPriceWei: chain?.gasPriceWei ?? null,
      version: ctx.version,
    })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: {
        tickCount: sql`CASE WHEN ${workerHeartbeat.instanceId} = excluded.instance_id THEN ${workerHeartbeat.tickCount} + 1 ELSE 1 END`,
        instanceId: ctx.instanceId,
        startedAt: ctx.startedAt,
        lastTickAt: now,
        chainId: CHAIN_ID,
        // keep the last known chain facts when this tick's RPC reads failed
        blockNumber: chain ? chain.blockNumber : sql`${workerHeartbeat.blockNumber}`,
        gasPriceWei: chain ? chain.gasPriceWei : sql`${workerHeartbeat.gasPriceWei}`,
        version: ctx.version,
      },
    });
}

/** Liveness pulse during a long tick (receipt waits): only bumps last_tick_at of this instance's row. */
export async function pulseHeartbeat(ctx: WorkerCtx): Promise<void> {
  await ctx.db
    .update(workerHeartbeat)
    .set({ lastTickAt: ctx.now() })
    .where(sql`${workerHeartbeat.id} = 1 AND ${workerHeartbeat.instanceId} = ${ctx.instanceId}`);
}

async function checkDuePositions(ctx: WorkerCtx, inputs: TickInputs, errors: string[]): Promise<number> {
  const due = await loadDuePositions(ctx.db, ctx.now(), MAX_POSITIONS_PER_TICK);
  let checked = 0;
  for (const ep of due) {
    if (ctx.shouldStop()) break;
    try {
      await checkPosition(ctx, ep, inputs);
      checked++;
    } catch (err) {
      errors.push(`position ${ep.position.id.slice(0, 8)}: ${errMsg(err, 150)}`);
      ctx.log.error({ positionId: ep.position.id, err: errMsg(err) }, "position check failed");
      const now = ctx.now();
      await ctx.store
        .updatePosition(ep.position.id, { lastCheckAt: now, nextCheckAt: new Date(now.getTime() + CHECK_ERROR_RETRY_MS) })
        .catch(() => {});
    }
  }
  return checked;
}

/** Deletes snapshots older than 90 days, at most once per (UTC) day. */
async function pruneSnapshots(ctx: WorkerCtx): Promise<void> {
  const now = ctx.now();
  const day = now.toISOString().slice(0, 10);
  if (ctx.state.lastPruneDay === day) return;
  const cutoff = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 86_400_000);
  const res = await ctx.db.delete(positionSnapshots).where(lt(positionSnapshots.takenAt, cutoff));
  ctx.state.lastPruneDay = day;
  if (res.rowCount) ctx.log.info({ deleted: res.rowCount }, "pruned old position snapshots");
}
