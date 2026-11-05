import { formatGwei, formatKub } from "@kubstake/core/browser";
import type { SettingsRow } from "@kubstake/db";
import type { ActionResult } from "@/lib/action-result";

// Shared by the settings page (server), its action ("use server") and the form (client): pure, no server imports.

export const SETTINGS_FIELDS = [
  "gasReserveKub",
  "maxGasPriceGwei",
  "minIntervalSec",
  "rFloorKub",
  "checkMinSec",
  "checkMaxSec",
  "validatorSyncSec",
] as const;

export type SettingsField = (typeof SETTINGS_FIELDS)[number];
export type SettingsFormValues = Record<SettingsField, string>;

/** Action state: the usual result + the values to show in the (uncontrolled) inputs after React resets the form. */
export type SettingsFormState = ActionResult & { values?: SettingsFormValues };

/**
 * Bounds enforced by the settings action. Identical to SEED_LIMITS in packages/core/src/env.ts (the
 * GAS_RESERVE_KUB … VALIDATOR_SYNC_SEC seed vars) — keep the two in sync.
 */
export const SETTINGS_LIMITS = {
  gasReserveMinKub: "0.05",
  maxGasPriceMinGwei: "1",
  maxGasPriceMaxGwei: "1000",
  minIntervalMinSec: 3600,
  checkMinMinSec: 300,
  validatorSyncMinSec: 300,
  maxSec: 31_536_000,
} as const;

export function settingsToFormValues(s: SettingsRow): SettingsFormValues {
  return {
    gasReserveKub: formatKub(s.gasReserveWei, 18),
    maxGasPriceGwei: formatGwei(s.maxGasPriceWei),
    minIntervalSec: String(s.minIntervalSec),
    rFloorKub: formatKub(s.rFloorWei, 18),
    checkMinSec: String(s.checkMinSec),
    checkMaxSec: String(s.checkMaxSec),
    validatorSyncSec: String(s.validatorSyncSec),
  };
}
