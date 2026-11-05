import { GAS_EST_1TX, GAS_EST_2TX, GAS_EST_CLAIM, gasCostWei, rStarWei } from "./math";

export type Strategy = "optimal" | "threshold" | "schedule";

export type CompoundInput = {
  strategy: Strategy;
  /** threshold mode: trigger when pending >= this. null/undefined → falls back to the optimal threshold. */
  thresholdWei?: bigint | null;
  /** schedule mode: true when next_run_at <= now. */
  scheduleDue?: boolean;
  /** schedule mode dust guard. null/undefined → 2 × C of the chosen path. */
  minRewardWei?: bigint | null;
  principalWei: bigint;
  pendingWei: bigint;
  /** Wallet free (native) balance. */
  liquidWei: bigint;
  gasPriceWei: bigint;
  maxGasPriceWei: bigint;
  gasReserveWei: bigint;
  rFloorWei: bigint;
  minIntervalSec: number;
  lastCompoundAt: Date | null;
  now: Date;
  validatorActive: boolean;
  delegationEnabled: boolean;
  paused: boolean;
  isOfficialPool: boolean;
  backoffLevel: number;
  lastFailureAt: Date | null;
};

export type DecisionAction = "skip" | "compound_1tx" | "compound_2tx" | "claim_only";
export type DecisionReason =
  | "ok"
  | "below_threshold"
  | "not_due"
  | "dust_reward"
  | "gas_too_high"
  | "min_interval"
  | "backoff"
  | "insufficient_gas"
  | "zero_pending"
  | "no_principal";

export type CompoundDecision = {
  action: DecisionAction;
  reason: DecisionReason;
  claimOnly: boolean;
  /** Trigger threshold for the active mode (hint for UI/ETA). */
  thresholdWei: bigint;
  /** R* = isqrt(2·C·P) with C of the chosen path — always computed, shown as a hint in every mode. */
  rStarWei: bigint;
  /** Expected gas cost of the chosen path (gasPrice × GAS_EST_*). */
  costWei: bigint;
  /** compound_1tx: pending; compound_2tx / claim_only / skip: 0n (2-tx value is computed after the claim). */
  valueWei: bigint;
  /** Set for backoff / min_interval skips: the earliest time the position may run again. */
  nextEligibleAt: Date | null;
};

const BACKOFF_BASE_MS = 15 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

/** min(2^level × 15 min, 24 h). */
export function backoffDelayMs(level: number): number {
  const lvl = Math.max(0, Math.min(Number.isFinite(level) ? Math.floor(level) : 0, 30));
  return Math.min(2 ** lvl * BACKOFF_BASE_MS, BACKOFF_MAX_MS);
}

type Path = "compound_1tx" | "compound_2tx" | "claim_only" | "none";

/**
 * Pure compound decision. Guard order (TASK §Interface contracts):
 * no_principal → zero_pending → claimOnly → path (1-tx / 2-tx / claim) + cost → threshold per mode
 * → backoff → min_interval → gas_too_high → mode check (below_threshold | not_due / dust_reward)
 * → insufficient_gas → ok.
 */
export function decideCompound(i: CompoundInput): CompoundDecision {
  const claimOnly = !i.validatorActive || !i.delegationEnabled || i.paused || i.isOfficialPool;
  const free = i.liquidWei - i.gasReserveWei;

  let path: Path;
  let costWei: bigint;
  if (claimOnly) {
    costWei = gasCostWei(i.gasPriceWei, GAS_EST_CLAIM);
    path = free >= costWei ? "claim_only" : "none";
  } else {
    const c1 = gasCostWei(i.gasPriceWei, GAS_EST_1TX);
    const c2 = gasCostWei(i.gasPriceWei, GAS_EST_2TX);
    if (free - c1 >= i.pendingWei) {
      path = "compound_1tx";
      costWei = c1;
    } else if (free >= c2) {
      path = "compound_2tx";
      costWei = c2;
    } else {
      // Neither path affordable; report the cheapest fallback (2-tx) cost for hints.
      path = "none";
      costWei = c2;
    }
  }

  const rStar = rStarWei(costWei, i.principalWei);
  const optimalThreshold = rStar > i.rFloorWei ? rStar : i.rFloorWei;
  let thresholdWei: bigint;
  switch (i.strategy) {
    case "threshold":
      thresholdWei = i.thresholdWei ?? optimalThreshold;
      break;
    case "schedule":
      thresholdWei = i.minRewardWei ?? 2n * costWei;
      break;
    default:
      thresholdWei = optimalThreshold;
  }

  const base = { claimOnly, thresholdWei, rStarWei: rStar, costWei };
  const skip = (reason: DecisionReason, nextEligibleAt: Date | null = null): CompoundDecision => ({
    ...base,
    action: "skip",
    reason,
    valueWei: 0n,
    nextEligibleAt,
  });

  if (i.principalWei <= 0n) return skip("no_principal");
  if (i.pendingWei <= 0n) return skip("zero_pending");

  const nowMs = i.now.getTime();
  if (i.lastFailureAt) {
    const until = i.lastFailureAt.getTime() + backoffDelayMs(i.backoffLevel);
    if (nowMs < until) return skip("backoff", new Date(until));
  }
  if (i.lastCompoundAt) {
    const until = i.lastCompoundAt.getTime() + i.minIntervalSec * 1000;
    if (nowMs < until) return skip("min_interval", new Date(until));
  }
  if (i.gasPriceWei > i.maxGasPriceWei) return skip("gas_too_high");

  if (i.strategy === "schedule") {
    if (!i.scheduleDue) return skip("not_due");
    if (i.pendingWei < thresholdWei) return skip("dust_reward");
  } else if (i.pendingWei < thresholdWei) {
    return skip("below_threshold");
  }

  if (path === "none") return skip("insufficient_gas");

  return {
    ...base,
    action: path,
    reason: "ok",
    valueWei: path === "compound_1tx" ? i.pendingWei : 0n,
    nextEligibleAt: null,
  };
}
