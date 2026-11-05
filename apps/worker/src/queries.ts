import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { positions, validators, wallets, type DbExecutor } from "@kubstake/db";
import type { EnginePosition } from "./engine";

// Position + wallet (public columns only — never the encrypted key) + validator, in EnginePosition shape.

const selection = {
  position: positions,
  wallet: { id: wallets.id, address: wallets.address },
  validator: {
    validatorId: validators.validatorId,
    shareAddress: validators.shareAddress,
    status: validators.status,
    delegationEnabled: validators.delegationEnabled,
    paused: validators.paused,
    isOfficialPool: validators.isOfficialPool,
    minDelegatedWei: validators.minDelegatedWei,
  },
};

export async function loadEnginePosition(db: DbExecutor, positionId: string): Promise<EnginePosition | null> {
  const [row] = await db
    .select(selection)
    .from(positions)
    .innerJoin(wallets, eq(wallets.id, positions.walletId))
    .innerJoin(validators, eq(validators.validatorId, positions.validatorId))
    .where(eq(positions.id, positionId))
    .limit(1);
  return row ?? null;
}

/**
 * Positions due for a check: next_check_at <= now, or (enabled schedule position whose next_run_at <= now
 * and that has not been checked since that slot). Disabled positions are still refreshed (state for the
 * UI) on their next_check_at cadence but never compound.
 */
export async function loadDuePositions(db: DbExecutor, now: Date, limit = 20): Promise<EnginePosition[]> {
  return db
    .select(selection)
    .from(positions)
    .innerJoin(wallets, eq(wallets.id, positions.walletId))
    .innerJoin(validators, eq(validators.validatorId, positions.validatorId))
    .where(
      or(
        lte(positions.nextCheckAt, now),
        and(
          eq(positions.enabled, true),
          eq(positions.strategy, "schedule"),
          lte(positions.nextRunAt, now),
          or(isNull(positions.lastCheckAt), lte(positions.lastCheckAt, positions.nextRunAt)),
        ),
      ),
    )
    .orderBy(asc(positions.nextCheckAt))
    .limit(limit);
}
