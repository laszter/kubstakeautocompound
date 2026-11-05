import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { appSettings, type AppSettingsRow } from "../schema";

export const SETTINGS_ID = 1;

export type SettingsRow = AppSettingsRow;

/** Values seeded from env on first boot (GAS_RESERVE_KUB, MAX_GAS_PRICE_GWEI, ...) and editable later. */
export type SettingsSeed = {
  gasReserveWei: bigint;
  maxGasPriceWei: bigint;
  minIntervalSec: number;
  rFloorWei: bigint;
  checkMinSec: number;
  checkMaxSec: number;
  validatorSyncSec: number;
};

const SEED_KEYS = [
  "gasReserveWei",
  "maxGasPriceWei",
  "minIntervalSec",
  "rFloorWei",
  "checkMinSec",
  "checkMaxSec",
  "validatorSyncSec",
] as const satisfies readonly (keyof SettingsSeed)[];

/** Inserts the single settings row from `seed` if it does not exist yet (existing values win), then returns it. */
export async function ensureSettings(db: DbExecutor, seed: SettingsSeed): Promise<SettingsRow> {
  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      gasReserveWei: seed.gasReserveWei,
      maxGasPriceWei: seed.maxGasPriceWei,
      minIntervalSec: seed.minIntervalSec,
      rFloorWei: seed.rFloorWei,
      checkMinSec: seed.checkMinSec,
      checkMaxSec: seed.checkMaxSec,
      validatorSyncSec: seed.validatorSyncSec,
    })
    .onConflictDoNothing({ target: appSettings.id });
  return getSettings(db);
}

export async function getSettings(db: DbExecutor): Promise<SettingsRow> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID)).limit(1);
  if (!row) throw new Error("app_settings row is missing — run the migrate step (ensureSettings) first");
  return row;
}

/** Updates only the known keys that are present (and not `undefined`) in `patch`. */
export async function updateSettings(db: DbExecutor, patch: Partial<SettingsSeed>): Promise<SettingsRow> {
  const set: Partial<SettingsSeed> = {};
  for (const key of SEED_KEYS) {
    if (patch[key] !== undefined) Object.assign(set, { [key]: patch[key] });
  }
  if (Object.keys(set).length === 0) return getSettings(db);
  const [row] = await db
    .update(appSettings)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(appSettings.id, SETTINGS_ID))
    .returning();
  if (!row) throw new Error("app_settings row is missing — run the migrate step (ensureSettings) first");
  return row;
}
