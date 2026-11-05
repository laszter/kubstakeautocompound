import { and, count, eq, lt, max, ne, notInArray, or } from "drizzle-orm";
import type { DiscoveredValidator as CoreDiscoveredValidator } from "@kubstake/core";
import { upsertValidators, validators, type DiscoveredValidator as DbDiscoveredValidator, type SettingsRow } from "@kubstake/db";
import type { WorkerCtx } from "./context";
import { errMsg } from "./errors";

// packages/db keeps a local copy of DiscoveredValidator (it must not depend on core at runtime). This
// compile-time assertion fails the worker typecheck/build if the two shapes ever drift apart.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const DISCOVERED_VALIDATOR_SHAPES_MATCH: Equals<CoreDiscoveredValidator, DbDiscoveredValidator> = true;

export type SyncResult = { discovered: number; written: number; markedInactive: number };

/** After a failed sync, wait at least this long before the tick tries again. */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

/**
 * discoverValidators (read-only RPC) → upsertValidators → mark rows that are no longer discovered as inactive
 * (status=2, delegation_enabled=false), except validators whose reads failed in this run.
 * Errors are logged and swallowed unless `throwOnError` (used by the `sync_validators` action).
 */
export async function syncValidators(ctx: WorkerCtx, opts: { throwOnError?: boolean } = {}): Promise<SyncResult | null> {
  const syncedAt = ctx.now();
  ctx.state.lastValidatorSyncAttemptAt = syncedAt.getTime();
  try {
    const { validators: found, failedIds } = await ctx.chain.discoverValidators();
    const written = await upsertValidators(ctx.db, found, syncedAt);
    const markedInactive = found.length > 0 ? await markMissingInactive(ctx, found, failedIds, syncedAt) : 0;
    const delegatable = found.filter((v) => v.status === 1 && v.delegationEnabled && !v.paused && !v.isOfficialPool).length;
    ctx.log.info(
      { n: found.length, delegatable, written, markedInactive, failed: failedIds.length },
      `validator sync n=${found.length}`,
    );
    return { discovered: found.length, written, markedInactive };
  } catch (err) {
    ctx.log.error({ err: errMsg(err) }, "validator sync failed");
    if (opts.throwOnError) throw err;
    return null;
  }
}

async function markMissingInactive(
  ctx: WorkerCtx,
  found: CoreDiscoveredValidator[],
  failedIds: number[],
  syncedAt: Date,
): Promise<number> {
  const keep = [...new Set([...found.map((v) => v.validatorId), ...failedIds])];
  const rows = await ctx.db
    .update(validators)
    .set({ status: 2, delegationEnabled: false })
    .where(
      and(
        notInArray(validators.validatorId, keep),
        lt(validators.syncedAt, syncedAt),
        or(ne(validators.status, 2), eq(validators.delegationEnabled, true)),
      ),
    )
    .returning({ validatorId: validators.validatorId });
  if (rows.length > 0) {
    ctx.log.warn({ validatorIds: rows.map((r) => r.validatorId) }, "validators no longer active on-chain; marked inactive");
  }
  return rows.length;
}

/** Sync when there are no rows yet or the newest synced_at is older than validator_sync_sec. */
export async function maybeSyncValidators(ctx: WorkerCtx, settings: Pick<SettingsRow, "validatorSyncSec">): Promise<boolean> {
  const now = ctx.now().getTime();
  const last = ctx.state.lastValidatorSyncAttemptAt;
  const [agg] = await ctx.db.select({ newest: max(validators.syncedAt), n: count() }).from(validators);
  const newest = agg?.newest ? new Date(agg.newest).getTime() : null;
  const due = !agg || agg.n === 0 || newest === null || now - newest >= settings.validatorSyncSec * 1000;
  if (!due) return false;
  const minGap = Math.min(RETRY_AFTER_FAILURE_MS, settings.validatorSyncSec * 1000);
  if (last !== null && now - last < minGap) return false;
  await syncValidators(ctx);
  return true;
}
