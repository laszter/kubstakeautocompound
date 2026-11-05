import "server-only";
import {
  APR_DEFAULT,
  backoffDelayMs,
  decideCompound,
  etaSeconds,
  GAS_EST_1TX,
  GAS_EST_2TX,
  GAS_EST_CLAIM,
  GAS_LIMIT_FLOOR,
  gasCostWei,
  gweiToWei,
  parseKub,
  tStarSeconds,
  type CompoundDecision,
  type DecisionReason,
} from "@kubstake/core";
import type { PositionRow, SettingsRow, ValidatorRow } from "@kubstake/db";

// Display-only estimates for the position pages. The worker re-reads the chain and decides for real;
// everything here uses the last DB snapshot + the heartbeat gas price (TASK: decideCompound is pure → hints).

export const WEI_PER_KUB = 10n ** 18n;
/** Used when the worker has not reported a gas price yet (KUB chain ≈ 25 gwei). */
export const FALLBACK_GAS_PRICE_WEI = gweiToWei(25);

export type HintSettings = Pick<SettingsRow, "gasReserveWei" | "maxGasPriceWei" | "rFloorWei" | "minIntervalSec">;

/** Defaults from .env.example, used only if the app_settings row is missing. */
export const DEFAULT_HINT_SETTINGS: HintSettings = {
  gasReserveWei: parseKub("0.05"),
  maxGasPriceWei: gweiToWei(50),
  rFloorWei: parseKub("0.5"),
  minIntervalSec: 3600,
};

/** New delegations are offered only for `delegation && !paused && !isOfficialPool && status == 1`. */
export function isValidatorDelegatable(
  v: Pick<ValidatorRow, "delegationEnabled" | "paused" | "isOfficialPool" | "status">,
): boolean {
  return v.delegationEnabled && !v.paused && !v.isOfficialPool && v.status === 1;
}

export function effectiveGasPrice(gasPriceWei: bigint | null | undefined): { wei: bigint; fallback: boolean } {
  return gasPriceWei && gasPriceWei > 0n ? { wei: gasPriceWei, fallback: false } : { wei: FALLBACK_GAS_PRICE_WEI, fallback: true };
}

/** Gas kept aside for a manual delegate tx (gas-limit floor × gas price) when computing the max amount. */
export function delegateGasWei(gasPriceWei: bigint): bigint {
  return gasCostWei(gasPriceWei, GAS_LIMIT_FLOOR.delegate);
}

/** Max KUB a manual delegate may use: balance − gas reserve − delegate gas (never negative). null = balance unknown. */
export function maxDelegatableWei(balanceWei: bigint | null, reserveWei: bigint, gasPriceWei: bigint): bigint | null {
  if (balanceWei === null) return null;
  const max = balanceWei - reserveWei - delegateGasWei(gasPriceWei);
  return max > 0n ? max : 0n;
}

export type CompoundPath = "compound_1tx" | "compound_2tx" | "claim_only" | "none";

export const PATH_LABELS: Record<CompoundPath, string> = {
  compound_1tx: "1-tx (delegate reward ที่ค้างในครั้งเดียว)",
  compound_2tx: "2-tx (claim แล้ว delegate)",
  claim_only: "claim อย่างเดียว",
  none: "KUB ใน wallet ไม่พอค่า gas",
};

export const DECISION_REASON_LABELS: Record<DecisionReason, string> = {
  ok: "ถึงเกณฑ์แล้ว — worker จะ compound ในรอบตรวจถัดไป",
  below_threshold: "ยังไม่ถึงเกณฑ์",
  not_due: "ยังไม่ถึงเวลาตาม schedule",
  dust_reward: "reward น้อยกว่าขั้นต่ำของ schedule (dust) — จะข้ามรอบ",
  gas_too_high: "gas price สูงกว่า max gas price — ข้ามรอบนี้",
  min_interval: "ยังไม่ครบ min interval นับจาก compound ล่าสุด",
  backoff: "พักหลังล้มเหลว (backoff)",
  insufficient_gas: "KUB ใน wallet ไม่พอค่า gas + reserve",
  zero_pending: "ยังไม่มี reward ค้าง",
  no_principal: "ยังไม่มีเงินต้น (ยังไม่ได้ delegate)",
};

export type PositionHints = {
  decision: CompoundDecision;
  path: CompoundPath;
  claimOnly: boolean;
  apr: number;
  aprIsDefault: boolean;
  gasPriceWei: bigint;
  gasPriceIsFallback: boolean;
  /** wallet balance used for the estimate (null = unknown → treated as 0) */
  liquidWei: bigint | null;
  /** C of the chosen path */
  costWei: bigint;
  /** R* = isqrt(2·C·P) */
  rStarWei: bigint;
  /** optimal trigger = max(R*, R_FLOOR) */
  optimalTargetWei: bigint;
  /** trigger of the active mode (optimal target | threshold | schedule min reward) */
  activeTargetWei: bigint;
  /** seconds until pending reaches the optimal target (Infinity = never at current APR) */
  optimalEtaSec: number;
  /** seconds until pending reaches the active mode's target */
  activeEtaSec: number;
  tStarSec: number;
  /** schedule default min reward = 2 × C */
  defaultMinRewardWei: bigint;
  backoffUntil: Date | null;
};

type HintPosition = Pick<
  PositionRow,
  | "strategy"
  | "thresholdWei"
  | "minRewardWei"
  | "nextRunAt"
  | "principalWei"
  | "pendingWei"
  | "liquidWei"
  | "aprEst"
  | "lastCompoundAt"
  | "backoffLevel"
  | "lastFailureAt"
  | "claimOnly"
>;

export function computePositionHints(input: {
  position: HintPosition;
  validator: Pick<ValidatorRow, "delegationEnabled" | "paused" | "isOfficialPool" | "status">;
  walletBalanceWei: bigint | null;
  settings: HintSettings;
  gasPriceWei: bigint | null;
  now: Date;
}): PositionHints {
  const { position: p, validator: v, settings: s, now } = input;
  const gas = effectiveGasPrice(input.gasPriceWei);
  const aprIsDefault = !(p.aprEst !== null && Number.isFinite(p.aprEst) && p.aprEst > 0);
  const apr = aprIsDefault ? APR_DEFAULT : (p.aprEst as number);
  const liquidWei = input.walletBalanceWei ?? p.liquidWei;

  const decision = decideCompound({
    strategy: p.strategy,
    thresholdWei: p.thresholdWei,
    scheduleDue: p.strategy === "schedule" && p.nextRunAt !== null && p.nextRunAt.getTime() <= now.getTime(),
    minRewardWei: p.minRewardWei,
    principalWei: p.principalWei,
    pendingWei: p.pendingWei,
    liquidWei: liquidWei ?? 0n,
    gasPriceWei: gas.wei,
    maxGasPriceWei: s.maxGasPriceWei,
    gasReserveWei: s.gasReserveWei,
    rFloorWei: s.rFloorWei,
    minIntervalSec: s.minIntervalSec,
    lastCompoundAt: p.lastCompoundAt,
    now,
    validatorActive: v.status === 1,
    delegationEnabled: v.delegationEnabled,
    paused: v.paused,
    isOfficialPool: v.isOfficialPool,
    backoffLevel: p.backoffLevel,
    lastFailureAt: p.lastFailureAt,
  });

  // Same path selection as decideCompound (it only exposes the cost), for the label.
  const free = (liquidWei ?? 0n) - s.gasReserveWei;
  let path: CompoundPath;
  if (decision.claimOnly) {
    path = free >= gasCostWei(gas.wei, GAS_EST_CLAIM) ? "claim_only" : "none";
  } else if (free - gasCostWei(gas.wei, GAS_EST_1TX) >= p.pendingWei) {
    path = "compound_1tx";
  } else if (free >= gasCostWei(gas.wei, GAS_EST_2TX)) {
    path = "compound_2tx";
  } else {
    path = "none";
  }

  const rStar = decision.rStarWei;
  const optimalTargetWei = rStar > s.rFloorWei ? rStar : s.rFloorWei;
  const tStarSec = tStarSeconds(decision.costWei, p.principalWei, apr);
  const backoffUntil =
    p.lastFailureAt && p.backoffLevel > 0 ? new Date(p.lastFailureAt.getTime() + backoffDelayMs(p.backoffLevel)) : null;

  return {
    decision,
    path,
    claimOnly: decision.claimOnly || p.claimOnly,
    apr,
    aprIsDefault,
    gasPriceWei: gas.wei,
    gasPriceIsFallback: gas.fallback,
    liquidWei,
    costWei: decision.costWei,
    rStarWei: rStar,
    optimalTargetWei,
    activeTargetWei: decision.thresholdWei,
    optimalEtaSec: etaSeconds(optimalTargetWei, p.pendingWei, p.principalWei, apr),
    activeEtaSec: etaSeconds(decision.thresholdWei, p.pendingWei, p.principalWei, apr),
    tStarSec,
    defaultMinRewardWei: 2n * decision.costWei,
    backoffUntil: backoffUntil && backoffUntil.getTime() > now.getTime() ? backoffUntil : null,
  };
}

/** APR as a percentage string, e.g. 0.0058 → "0.58%". */
export function formatApr(apr: number): string {
  return `${(apr * 100).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
}
