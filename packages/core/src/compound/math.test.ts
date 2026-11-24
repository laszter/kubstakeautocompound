import { describe, expect, it } from "vitest";
import {
  APR_DEFAULT,
  GAS_EST_1TX,
  GAS_EST_2TX,
  SECONDS_PER_YEAR,
  aprSample,
  compoundProjection,
  etaSeconds,
  gasCostWei,
  isqrt,
  nextCheckDelaySec,
  rStarWei,
  tStarSeconds,
  updateEwma,
} from "./math";

const E18 = 10n ** 18n;
const GWEI = 10n ** 9n;
const DAY = 86_400;
const kub = (w: bigint) => Number(w) / 1e18;
/** RECON §2 worked example cost: C = 0.005184 KUB (= 25 gwei × 207,360 gas ≈ measured 1-tx gasUsed). */
const C_WORKED = 5_184_000_000_000_000n;

describe("isqrt", () => {
  it("small values", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(3n)).toBe(1n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrt(10n)).toBe(3n);
  });

  it("10^36 → 10^18", () => {
    expect(isqrt(10n ** 36n)).toBe(10n ** 18n);
  });

  it("perfect squares ±1", () => {
    for (const r of [2n, 3n, 10n, 12345n, 10n ** 9n + 7n, 2n ** 64n - 1n, 10n ** 30n + 3n]) {
      const sq = r * r;
      expect(isqrt(sq)).toBe(r);
      expect(isqrt(sq - 1n)).toBe(r - 1n);
      expect(isqrt(sq + 1n)).toBe(r);
    }
  });

  it("floor property on huge values and throws on negative", () => {
    const n = 2n ** 255n + 12345678901234567890n;
    const r = isqrt(n);
    expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });
});

describe("gasCostWei / rStarWei (RECON §2 worked example)", () => {
  it("gasCostWei = gasPrice × units", () => {
    expect(gasCostWei(25n * GWEI, GAS_EST_1TX)).toBe(5_250_000_000_000_000n);
    expect(gasCostWei(25n * GWEI, GAS_EST_2TX)).toBe(7_525_000_000_000_000n);
  });

  it("worked example C = 0.005184 KUB: P=10,000 → R*≈10.18, P=1,000 → 3.22, P=100,000 → 32.2", () => {
    expect(kub(rStarWei(C_WORKED, 10_000n * E18))).toBeCloseTo(10.18, 2);
    expect(Math.abs(kub(rStarWei(C_WORKED, 10_000n * E18)) - 10.18)).toBeLessThan(0.01);
    expect(Math.abs(kub(rStarWei(C_WORKED, 1_000n * E18)) - 3.22)).toBeLessThan(0.01);
    expect(Math.abs(kub(rStarWei(C_WORKED, 100_000n * E18)) - 32.2)).toBeLessThan(0.05);
  });

  it("with gasCostWei(25 gwei, 210,000) = 0.00525 KUB: R* = √105 ≈ 10.247 (P=10,000), √10.5 ≈ 3.240 (P=1,000)", () => {
    const c = gasCostWei(25n * GWEI, GAS_EST_1TX);
    expect(Math.abs(kub(rStarWei(c, 10_000n * E18)) - Math.sqrt(105))).toBeLessThan(1e-9);
    expect(Math.abs(kub(rStarWei(c, 1_000n * E18)) - Math.sqrt(10.5))).toBeLessThan(1e-9);
  });

  it("R* is exactly isqrt(2·C·P) and 0 for zero inputs", () => {
    const c = 5_250_000_000_000_000n;
    const p = 10_000n * E18;
    expect(rStarWei(c, p)).toBe(isqrt(2n * c * p));
    expect(rStarWei(0n, p)).toBe(0n);
    expect(rStarWei(c, 0n)).toBe(0n);
  });
});

describe("tStarSeconds", () => {
  it("P=10,000 KUB @0.58% ≈ 64 days (±2)", () => {
    expect(Math.abs(tStarSeconds(C_WORKED, 10_000n * E18, 0.0058) / DAY - 64)).toBeLessThan(2);
    expect(Math.abs(tStarSeconds(gasCostWei(25n * GWEI, GAS_EST_1TX), 10_000n * E18, 0.0058) / DAY - 64)).toBeLessThan(2);
  });

  it("P=1,000 ≈ 203 days, P=100,000 ≈ 20 days", () => {
    expect(Math.abs(tStarSeconds(C_WORKED, 1_000n * E18, 0.0058) / DAY - 203)).toBeLessThan(2);
    expect(Math.abs(tStarSeconds(C_WORKED, 100_000n * E18, 0.0058) / DAY - 20.3)).toBeLessThan(1);
  });

  it("Infinity when P=0 or apr<=0", () => {
    expect(tStarSeconds(C_WORKED, 0n, 0.0058)).toBe(Infinity);
    expect(tStarSeconds(C_WORKED, E18, 0)).toBe(Infinity);
    expect(tStarSeconds(C_WORKED, E18, -0.01)).toBe(Infinity);
  });

  it("consistency: R* ≈ P·r·t*", () => {
    const p = 10_000n * E18;
    const t = tStarSeconds(C_WORKED, p, APR_DEFAULT);
    const rFromT = kub(p) * APR_DEFAULT * (t / SECONDS_PER_YEAR);
    expect(rFromT).toBeCloseTo(kub(rStarWei(C_WORKED, p)), 6);
  });
});

describe("etaSeconds", () => {
  it("0 when already at target, otherwise (target-R)/(P·r)", () => {
    const p = 10_000n * E18;
    expect(etaSeconds(5n * E18, 5n * E18, p, 0.0058)).toBe(0);
    expect(etaSeconds(5n * E18, 6n * E18, p, 0.0058)).toBe(0);
    // 58 KUB/yr on 10,000 KUB @0.58% → 5.8 KUB needs 0.1 yr
    expect(etaSeconds(58n * 10n ** 17n, 0n, p, 0.0058)).toBeCloseTo(0.1 * SECONDS_PER_YEAR, 3);
  });

  it("Infinity when unreachable", () => {
    expect(etaSeconds(E18, 0n, 0n, 0.0058)).toBe(Infinity);
    expect(etaSeconds(E18, 0n, E18, 0)).toBe(Infinity);
  });
});

describe("aprSample / updateEwma", () => {
  it("annualises the reward growth", () => {
    const p = 10_000n * E18;
    // 58 KUB/yr ⇒ per hour = 58/8760 KUB
    const perHour = (58n * E18) / 8760n;
    const s = aprSample(E18, E18 + perHour, p, 3600);
    expect(s).not.toBeNull();
    expect(s!).toBeCloseTo(0.0058 * (SECONDS_PER_YEAR / (8760 * 3600)), 6);
  });

  it("null for short dt, zero principal or decreasing reward", () => {
    expect(aprSample(0n, E18, E18, 599)).toBeNull();
    expect(aprSample(0n, E18, 0n, 3600)).toBeNull();
    expect(aprSample(2n * E18, E18, E18, 3600)).toBeNull();
    expect(aprSample(E18, E18, E18, 3600)).toBe(0);
  });

  it("EWMA", () => {
    expect(updateEwma(null, 0.01)).toBe(0.01);
    expect(updateEwma(0.005, 0.01)).toBeCloseTo(0.2 * 0.01 + 0.8 * 0.005, 12);
    expect(updateEwma(0.005, 0.01, 0.5)).toBeCloseTo(0.0075, 12);
  });
});

describe("nextCheckDelaySec", () => {
  it("clamps eta/4 between min and max", () => {
    expect(nextCheckDelaySec(4000, 900, 21_600)).toBe(1000);
    expect(nextCheckDelaySec(100, 900, 21_600)).toBe(900);
    expect(nextCheckDelaySec(10 ** 9, 900, 21_600)).toBe(21_600);
    expect(nextCheckDelaySec(Infinity, 900, 21_600)).toBe(21_600);
    expect(nextCheckDelaySec(Number.NaN, 900, 21_600)).toBe(21_600);
    expect(nextCheckDelaySec(0, 900, 21_600)).toBe(900);
  });
});

describe("compoundProjection", () => {
  // Measured on mainnet 2026-11-17: 1,700 KUB, APR 0.188% (raw snapshots), 25 gwei × 207,378 gas.
  const P = 1700;
  const R_APR = 0.00188;
  const C = 25 * 207_378 / 1e9;
  const rStar = Math.sqrt(2 * C * P);
  const at = (thresholdKub: number, years: number) =>
    compoundProjection({ principalKub: P, apr: R_APR, costKub: C, thresholdKub, years })!;

  /** Fixed-principal step-by-step reference: compound k at k·t earns R·r·(T − k·t), pays C. */
  function bruteForceNet(R: number, T: number): number {
    const t = R / (P * R_APR);
    let net = 0;
    for (let k = 1; k * t <= T + 1e-12; k++) net += R * R_APR * (T - k * t) - C;
    return net;
  }

  it("matches the step-by-step reference", () => {
    for (const R of [0.04, 0.5, 1, 2, rStar, 5]) {
      for (const T of [1, 3, 5, 10]) expect(at(R, T).netKub).toBeCloseTo(bruteForceNet(R, T), 9);
    }
  });

  it("small threshold: gas outweighs the compound gain", () => {
    const r = at(0.04, 1);
    expect(r.compounds).toBe(79);
    expect(r.gainKub).toBeCloseTo(0.00297, 5);
    expect(r.gasKub).toBeCloseTo(0.4096, 4);
    expect(r.netKub).toBeCloseTo(-0.4066, 4);
    expect(r.paybackYears).toBeCloseTo(68.94, 2);
  });

  it("R*: no compound in year 1, best net over 10 years", () => {
    expect(at(rStar, 1)).toMatchObject({ compounds: 0, gainKub: 0, gasKub: 0, netKub: 0 });
    const ten = at(rStar, 10);
    expect(ten.compounds).toBe(7);
    expect(ten.netKub).toBeCloseTo(0.2259, 4);
    for (const R of [0.04, 0.5, 1, 2, 5]) expect(at(R, 10).netKub).toBeLessThan(ten.netKub);
  });

  it("interval = R / (P·r)", () => {
    expect(at(rStar, 1).intervalYears * 365).toBeCloseTo(479.49, 2);
  });

  it("exact multiple of the interval is counted", () => {
    // t = 1 / (100 · 0.1) = 0.1 yr → 10 compounds in 1 yr despite float error in T / t.
    expect(compoundProjection({ principalKub: 100, apr: 0.1, costKub: 0, thresholdKub: 1, years: 1 })!.compounds).toBe(10);
  });

  it("null for invalid inputs", () => {
    const ok = { principalKub: P, apr: R_APR, costKub: C, thresholdKub: 1, years: 1 };
    expect(compoundProjection({ ...ok, principalKub: 0 })).toBeNull();
    expect(compoundProjection({ ...ok, apr: 0 })).toBeNull();
    expect(compoundProjection({ ...ok, thresholdKub: 0 })).toBeNull();
    expect(compoundProjection({ ...ok, costKub: -1 })).toBeNull();
    expect(compoundProjection({ ...ok, years: -1 })).toBeNull();
    expect(compoundProjection({ ...ok, apr: Number.NaN })).toBeNull();
    expect(compoundProjection({ ...ok, years: 0 })).toMatchObject({ compounds: 0, netKub: 0 });
  });
});
