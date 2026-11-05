import { describe, expect, it } from "vitest";
import { backoffDelayMs, decideCompound, type CompoundInput, type Strategy } from "./decide";
import { GAS_EST_1TX, GAS_EST_2TX, GAS_EST_CLAIM, isqrt } from "./math";

const E18 = 10n ** 18n;
const GWEI = 10n ** 9n;
const KUB = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const NOW = new Date("2026-11-04T12:00:00Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

const GAS = 25n * GWEI;
const P = 10_000n * E18;
const C1 = GAS * GAS_EST_1TX; // 0.00525 KUB
const C2 = GAS * GAS_EST_2TX; // 0.007525 KUB
const CC = GAS * GAS_EST_CLAIM; // 0.00275 KUB
const RSTAR_1 = isqrt(2n * C1 * P); // ≈ 10.247 KUB
const RSTAR_2 = isqrt(2n * C2 * P); // ≈ 12.27 KUB
const RSTAR_C = isqrt(2n * CC * P); // ≈ 7.42 KUB

/** Healthy optimal-mode position: 10,000 KUB principal, 15 KUB pending, 20 KUB liquid, compounded 2h ago. */
function input(over: Partial<CompoundInput> = {}): CompoundInput {
  return {
    strategy: "optimal",
    thresholdWei: null,
    scheduleDue: false,
    minRewardWei: null,
    principalWei: P,
    pendingWei: KUB(15),
    liquidWei: KUB(20),
    gasPriceWei: GAS,
    maxGasPriceWei: 50n * GWEI,
    gasReserveWei: KUB(0.05),
    rFloorWei: KUB(0.5),
    minIntervalSec: 3600,
    lastCompoundAt: ago(7200),
    now: NOW,
    validatorActive: true,
    delegationEnabled: true,
    paused: false,
    isOfficialPool: false,
    backoffLevel: 0,
    lastFailureAt: null,
    ...over,
  };
}

/** Per-mode settings under which the mode check itself passes for the default 15 KUB pending. */
const MODES: Record<Strategy, Partial<CompoundInput>> = {
  optimal: { strategy: "optimal" },
  threshold: { strategy: "threshold", thresholdWei: KUB(1) },
  schedule: { strategy: "schedule", scheduleDue: true },
};
const modes = Object.keys(MODES) as Strategy[];

describe("decideCompound — common guards × 3 modes", () => {
  it.each(modes)("[%s] ok → compound_1tx with value = pending", (m) => {
    const d = decideCompound(input(MODES[m]));
    expect(d).toMatchObject({ action: "compound_1tx", reason: "ok", claimOnly: false, costWei: C1, valueWei: KUB(15) });
    expect(d.rStarWei).toBe(RSTAR_1);
    expect(d.nextEligibleAt).toBeNull();
  });

  it.each(modes)("[%s] ok → compound_2tx when liquid cannot front the pending reward", (m) => {
    const d = decideCompound(input({ ...MODES[m], liquidWei: KUB(1) }));
    expect(d).toMatchObject({ action: "compound_2tx", reason: "ok", costWei: C2, valueWei: 0n });
    expect(d.rStarWei).toBe(RSTAR_2);
  });

  it.each(modes)("[%s] insufficient_gas when liquid − reserve < C_2tx", (m) => {
    const d = decideCompound(input({ ...MODES[m], liquidWei: KUB(0.055) }));
    expect(d).toMatchObject({ action: "skip", reason: "insufficient_gas", costWei: C2, valueWei: 0n });
  });

  it.each(modes)("[%s] gas_too_high when gasPrice > max", (m) => {
    const d = decideCompound(input({ ...MODES[m], gasPriceWei: 51n * GWEI }));
    expect(d).toMatchObject({ action: "skip", reason: "gas_too_high" });
  });

  it.each(modes)("[%s] min_interval when last compound < MIN_INTERVAL ago", (m) => {
    const last = ago(1800);
    const d = decideCompound(input({ ...MODES[m], lastCompoundAt: last }));
    expect(d).toMatchObject({ action: "skip", reason: "min_interval" });
    expect(d.nextEligibleAt?.getTime()).toBe(last.getTime() + 3600_000);
  });

  it.each(modes)("[%s] backoff after a failure: min(2^level × 15min, 24h)", (m) => {
    const fail = ago(30 * 60);
    const d = decideCompound(input({ ...MODES[m], backoffLevel: 2, lastFailureAt: fail }));
    expect(d).toMatchObject({ action: "skip", reason: "backoff" });
    expect(d.nextEligibleAt?.getTime()).toBe(fail.getTime() + 60 * 60_000);
    // expired backoff no longer blocks
    expect(decideCompound(input({ ...MODES[m], backoffLevel: 2, lastFailureAt: ago(61 * 60) })).reason).toBe("ok");
  });

  it.each(modes)("[%s] zero_pending", (m) => {
    expect(decideCompound(input({ ...MODES[m], pendingWei: 0n }))).toMatchObject({ action: "skip", reason: "zero_pending" });
  });

  it.each(modes)("[%s] no_principal", (m) => {
    expect(decideCompound(input({ ...MODES[m], principalWei: 0n }))).toMatchObject({ action: "skip", reason: "no_principal", rStarWei: 0n });
  });

  it.each(modes)("[%s] claim_only when delegation is disabled", (m) => {
    const d = decideCompound(input({ ...MODES[m], delegationEnabled: false }));
    expect(d).toMatchObject({ action: "claim_only", reason: "ok", claimOnly: true, costWei: CC, valueWei: 0n, rStarWei: RSTAR_C });
  });
});

describe("decideCompound — optimal mode", () => {
  it("below_threshold when pending < max(R*, R_FLOOR)", () => {
    const d = decideCompound(input({ pendingWei: KUB(5) }));
    expect(d).toMatchObject({ action: "skip", reason: "below_threshold", thresholdWei: RSTAR_1 });
  });

  it("R_FLOOR wins when larger than R*", () => {
    const d = decideCompound(input({ rFloorWei: KUB(20) }));
    expect(d).toMatchObject({ reason: "below_threshold", thresholdWei: KUB(20) });
  });

  it("2-tx path uses C_2tx for R* (pending between R*_1tx and R*_2tx → below_threshold)", () => {
    const d = decideCompound(input({ pendingWei: KUB(11), liquidWei: KUB(1) }));
    expect(d).toMatchObject({ reason: "below_threshold", thresholdWei: RSTAR_2, costWei: C2 });
  });

  it("exactly at R* triggers", () => {
    expect(decideCompound(input({ pendingWei: RSTAR_1 })).action).toBe("compound_1tx");
    expect(decideCompound(input({ pendingWei: RSTAR_1 - 1n })).reason).toBe("below_threshold");
  });

  it("1-tx boundary: liquid − reserve − C_1tx must cover pending", () => {
    const exact = KUB(15) + KUB(0.05) + C1;
    expect(decideCompound(input({ liquidWei: exact })).action).toBe("compound_1tx");
    expect(decideCompound(input({ liquidWei: exact - 1n })).action).toBe("compound_2tx");
  });

  it("never-compounded position (lastCompoundAt null) is fine", () => {
    expect(decideCompound(input({ lastCompoundAt: null })).reason).toBe("ok");
  });
});

describe("decideCompound — threshold mode", () => {
  it("hit: pending >= user threshold even if below R*", () => {
    const d = decideCompound(input({ strategy: "threshold", thresholdWei: KUB(1), pendingWei: KUB(2) }));
    expect(d).toMatchObject({ action: "compound_1tx", reason: "ok", thresholdWei: KUB(1), valueWei: KUB(2) });
    expect(d.rStarWei).toBe(RSTAR_1); // still reported as a hint
  });

  it("miss: pending < user threshold even if above R*", () => {
    const d = decideCompound(input({ strategy: "threshold", thresholdWei: KUB(20) }));
    expect(d).toMatchObject({ action: "skip", reason: "below_threshold", thresholdWei: KUB(20) });
  });

  it("missing threshold falls back to the optimal threshold", () => {
    const d = decideCompound(input({ strategy: "threshold", thresholdWei: null, pendingWei: KUB(5) }));
    expect(d).toMatchObject({ reason: "below_threshold", thresholdWei: RSTAR_1 });
  });
});

describe("decideCompound — schedule mode", () => {
  it("not_due when the cron slot has not arrived", () => {
    const d = decideCompound(input({ strategy: "schedule", scheduleDue: false }));
    expect(d).toMatchObject({ action: "skip", reason: "not_due" });
  });

  it("dust_reward when due but pending < 2 × C (default min reward)", () => {
    const d = decideCompound(input({ strategy: "schedule", scheduleDue: true, pendingWei: C1 * 2n - 1n }));
    expect(d).toMatchObject({ action: "skip", reason: "dust_reward", thresholdWei: 2n * C1 });
  });

  it("dust_reward with explicit min_reward", () => {
    const d = decideCompound(input({ strategy: "schedule", scheduleDue: true, minRewardWei: KUB(2), pendingWei: KUB(1) }));
    expect(d).toMatchObject({ reason: "dust_reward", thresholdWei: KUB(2) });
  });

  it("ok when due and pending >= min reward, ignoring R*", () => {
    const d = decideCompound(input({ strategy: "schedule", scheduleDue: true, pendingWei: KUB(1) }));
    expect(d).toMatchObject({ action: "compound_1tx", reason: "ok", valueWei: KUB(1) });
    expect(d.rStarWei).toBe(RSTAR_1);
  });

  it("schedule + claim-only claims when due", () => {
    const d = decideCompound(input({ strategy: "schedule", scheduleDue: true, paused: true, pendingWei: KUB(1) }));
    expect(d).toMatchObject({ action: "claim_only", reason: "ok", claimOnly: true, thresholdWei: 2n * CC });
  });
});

describe("decideCompound — claim-only mode", () => {
  it.each([
    ["delegation disabled", { delegationEnabled: false }],
    ["paused", { paused: true }],
    ["official pool", { isOfficialPool: true }],
    ["validator inactive", { validatorActive: false }],
  ] as const)("%s → claim_only", (_label, over) => {
    const d = decideCompound(input(over));
    expect(d).toMatchObject({ action: "claim_only", claimOnly: true, costWei: CC, valueWei: 0n });
  });

  it("uses R* with C_claim as threshold (below → skip, claimOnly still flagged)", () => {
    const d = decideCompound(input({ delegationEnabled: false, pendingWei: KUB(5) }));
    expect(d).toMatchObject({ action: "skip", reason: "below_threshold", claimOnly: true, thresholdWei: RSTAR_C });
  });

  it("insufficient_gas when liquid − reserve < C_claim", () => {
    const d = decideCompound(input({ delegationEnabled: false, liquidWei: KUB(0.05) + CC - 1n }));
    expect(d).toMatchObject({ action: "skip", reason: "insufficient_gas", claimOnly: true });
  });

  it("does not need liquid to cover pending (claim has no value)", () => {
    const d = decideCompound(input({ delegationEnabled: false, liquidWei: KUB(0.06) }));
    expect(d.action).toBe("claim_only");
  });
});

describe("decideCompound — guard order", () => {
  it("no_principal before zero_pending", () => {
    expect(decideCompound(input({ principalWei: 0n, pendingWei: 0n })).reason).toBe("no_principal");
  });

  it("zero_pending before backoff / min_interval / gas", () => {
    const d = decideCompound(
      input({ pendingWei: 0n, lastFailureAt: ago(60), backoffLevel: 3, lastCompoundAt: ago(60), gasPriceWei: 100n * GWEI }),
    );
    expect(d.reason).toBe("zero_pending");
  });

  it("backoff before min_interval before gas_too_high before mode check", () => {
    const all = { lastFailureAt: ago(60), backoffLevel: 1, lastCompoundAt: ago(60), gasPriceWei: 100n * GWEI, pendingWei: KUB(1) };
    expect(decideCompound(input(all)).reason).toBe("backoff");
    expect(decideCompound(input({ ...all, lastFailureAt: null })).reason).toBe("min_interval");
    expect(decideCompound(input({ ...all, lastFailureAt: null, lastCompoundAt: null })).reason).toBe("gas_too_high");
    expect(decideCompound(input({ ...all, lastFailureAt: null, lastCompoundAt: null, gasPriceWei: GAS })).reason).toBe(
      "below_threshold",
    );
  });

  it("gas_too_high before not_due in schedule mode", () => {
    expect(decideCompound(input({ strategy: "schedule", scheduleDue: false, gasPriceWei: 100n * GWEI })).reason).toBe("gas_too_high");
  });

  it("mode check before insufficient_gas", () => {
    expect(decideCompound(input({ pendingWei: KUB(1), liquidWei: 0n })).reason).toBe("below_threshold");
    expect(decideCompound(input({ strategy: "schedule", scheduleDue: false, liquidWei: 0n })).reason).toBe("not_due");
  });
});

describe("backoffDelayMs", () => {
  it("doubles from 15 min and caps at 24h", () => {
    expect(backoffDelayMs(0)).toBe(15 * 60_000);
    expect(backoffDelayMs(1)).toBe(30 * 60_000);
    expect(backoffDelayMs(6)).toBe(16 * 3600_000);
    expect(backoffDelayMs(7)).toBe(24 * 3600_000);
    expect(backoffDelayMs(1000)).toBe(24 * 3600_000);
  });

  it("24h cap applies in decideCompound", () => {
    expect(decideCompound(input({ backoffLevel: 12, lastFailureAt: ago(23 * 3600) })).reason).toBe("backoff");
    expect(decideCompound(input({ backoffLevel: 12, lastFailureAt: ago(24 * 3600 + 1) })).reason).toBe("ok");
  });
});

describe("decideCompound — small principal", () => {
  const small = 100n * E18;
  const rStar = isqrt(2n * C1 * small); // ≈ 1.0247 KUB

  it("compounds as soon as pending reaches R*, with no minimum principal", () => {
    const d = decideCompound(input({ principalWei: small, pendingWei: rStar }));
    expect(d).toMatchObject({ action: "compound_1tx", reason: "ok", thresholdWei: rStar, valueWei: rStar });
  });

  it("keeps waiting while pending is below R*", () => {
    const d = decideCompound(input({ principalWei: small, pendingWei: rStar - 1n }));
    expect(d).toMatchObject({ action: "skip", reason: "below_threshold" });
  });
});
