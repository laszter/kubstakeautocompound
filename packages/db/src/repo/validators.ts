import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { validators } from "../schema";

// Local copy of `DiscoveredValidator` from @kubstake/core, kept here on purpose so packages/db does not
// depend on core's source/runtime. It MUST stay structurally identical to core's type: the worker asserts
// this at compile time (`DISCOVERED_VALIDATOR_SHAPES_MATCH` in apps/worker/src/validatorSync.ts), so any
// drift fails `npm run typecheck -w @kubstake/worker` (and therefore root `npm run typecheck`).
type Address = `0x${string}`;
export type DiscoveredValidator = {
  validatorId: number;
  shareAddress: Address;
  signer: Address;
  status: number;
  commissionBps: number;
  infraCommissionBps: number;
  selfStakeWei: bigint;
  delegatedWei: bigint;
  minDelegatedWei: bigint;
  delegationEnabled: boolean;
  paused: boolean;
  isOfficialPool: boolean;
  inMinimalSet: boolean;
  totalSupplyWei: bigint;
  name?: string;
  imageUrl?: string;
};

/** Columns that are never touched by the ON CONFLICT update. */
const KEEP_ON_CONFLICT = new Set<string>(["validatorId", "createdAt", "name", "imageUrl"]);

/** `SET col = excluded.col` for every column except the kept ones; name/image keep the old value when the new one is null. */
function conflictSet(): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(getTableColumns(validators))) {
    if (KEEP_ON_CONFLICT.has(key)) continue;
    set[key] = sql.raw(`excluded."${col.name}"`);
  }
  // subgraph profiles are best-effort: a failed subgraph fetch must not wipe names we already know
  set.name = sql`coalesce(excluded.name, validators.name)`;
  set.imageUrl = sql`coalesce(excluded.image_url, validators.image_url)`;
  return set;
}

/**
 * Inserts or updates (by `validator_id`) every discovered validator. `share_address` is stored lowercase.
 * Validators missing from `rows` are left untouched. Returns the number of rows written.
 */
export async function upsertValidators(db: DbExecutor, rows: DiscoveredValidator[], syncedAt: Date): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((v) => ({
    validatorId: v.validatorId,
    shareAddress: v.shareAddress.toLowerCase(),
    signer: v.signer,
    name: v.name ?? null,
    imageUrl: v.imageUrl ?? null,
    status: v.status,
    commissionBps: v.commissionBps,
    infraCommissionBps: v.infraCommissionBps,
    selfStakeWei: v.selfStakeWei,
    delegatedWei: v.delegatedWei,
    totalSupplyWei: v.totalSupplyWei,
    minDelegatedWei: v.minDelegatedWei,
    delegationEnabled: v.delegationEnabled,
    paused: v.paused,
    isOfficialPool: v.isOfficialPool,
    inMinimalSet: v.inMinimalSet,
    syncedAt,
  }));
  const written = await db
    .insert(validators)
    .values(values)
    .onConflictDoUpdate({ target: validators.validatorId, set: conflictSet() })
    .returning({ validatorId: validators.validatorId });
  return written.length;
}
