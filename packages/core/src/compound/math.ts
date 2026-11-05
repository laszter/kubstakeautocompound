// Compound economics (RECON §2). Money math in BigInt wei; time/rate estimates in Number at KUB scale.
//
// Loss rate L(t) = C/t + P·r²·t/2  →  t* = √(2C/(P·r²)),  R* = P·r·t* = √(2·C·P)  (independent of r).

/** Expected gasUsed (not limits) per compound path. */
export const GAS_EST_1TX = 210_000n,
  GAS_EST_2TX = 301_000n,
  GAS_EST_CLAIM = 110_000n,
  SECONDS_PER_YEAR = 31_536_000,
  /** Delegator APR prior before any live sample (~0.58%/yr, volatile — measure live). */
  APR_DEFAULT = 0.0058,
  EWMA_ALPHA = 0.2;

const WEI_PER_KUB = 1e18;

const toKub = (wei: bigint) => Number(wei) / WEI_PER_KUB;

/** floor(√n) for BigInt. Throws for n < 0. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt: negative input");
  if (n < 2n) return n;
  // Newton iteration from an upper bound derived from the bit length.
  let x = 1n << (BigInt(n.toString(2).length + 1) >> 1n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function gasCostWei(gasPrice: bigint, gasUnits: bigint): bigint {
  return gasPrice * gasUnits;
}

/** Optimal reward to compound at: R* = isqrt(2·C·P). 0 when C or P is 0. */
export function rStarWei(costWei: bigint, principalWei: bigint): bigint {
  if (costWei <= 0n || principalWei <= 0n) return 0n;
  return isqrt(2n * costWei * principalWei);
}

/** Optimal compound period in seconds: √(2C/(P·r²)) years. Infinity when P = 0 or apr <= 0. */
export function tStarSeconds(costWei: bigint, principalWei: bigint, apr: number): number {
  if (principalWei <= 0n || !(apr > 0) || !Number.isFinite(apr)) return Infinity;
  if (costWei <= 0n) return 0;
  const c = toKub(costWei);
  const p = toKub(principalWei);
  return Math.sqrt((2 * c) / (p * apr * apr)) * SECONDS_PER_YEAR;
}

/** Seconds until pending reaches target at rate `apr`: max(0, target − R) / (P · apr/yr). Infinity if unreachable. */
export function etaSeconds(targetWei: bigint, pendingWei: bigint, principalWei: bigint, apr: number): number {
  if (targetWei <= pendingWei) return 0;
  if (principalWei <= 0n || !(apr > 0) || !Number.isFinite(apr)) return Infinity;
  const perSecondKub = (toKub(principalWei) * apr) / SECONDS_PER_YEAR;
  return toKub(targetWei - pendingWei) / perSecondKub;
}

/**
 * Annualised reward-rate sample between two checks with no tx in between:
 * ((R_now − R_prev) / P) / dt × year. null if dt < 600s, P = 0, or R decreased (a claim happened).
 */
export function aprSample(rPrevWei: bigint, rNowWei: bigint, principalWei: bigint, dtSec: number): number | null {
  if (!Number.isFinite(dtSec) || dtSec < 600 || principalWei <= 0n || rNowWei < rPrevWei) return null;
  return (toKub(rNowWei - rPrevWei) / toKub(principalWei) / dtSec) * SECONDS_PER_YEAR;
}

export function updateEwma(prev: number | null, sample: number, alpha = EWMA_ALPHA): number {
  if (prev === null || !Number.isFinite(prev)) return sample;
  return alpha * sample + (1 - alpha) * prev;
}

/** Next check delay = clamp(eta/4, min, max), integer seconds. Non-finite eta → max. */
export function nextCheckDelaySec(etaSec: number, minSec: number, maxSec: number): number {
  if (Number.isNaN(etaSec) || etaSec === Infinity) return maxSec;
  return Math.round(Math.min(maxSec, Math.max(minSec, etaSec / 4)));
}
