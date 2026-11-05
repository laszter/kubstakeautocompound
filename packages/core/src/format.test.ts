import { describe, expect, it } from "vitest";
import { formatGwei, formatKub, gweiToWei, parseKub, shortAddr } from "./format";

const E18 = 10n ** 18n;

describe("formatKub", () => {
  it("truncates to 4 decimals by default", () => {
    expect(formatKub(1234567890000000000n)).toBe("1.2345");
    expect(formatKub(1999999999999999999n)).toBe("1.9999");
  });

  it("handles zero, integers, trailing zeros and tiny values", () => {
    expect(formatKub(0n)).toBe("0");
    expect(formatKub(5n * E18)).toBe("5");
    expect(formatKub(1500000000000000000n)).toBe("1.5");
    expect(formatKub(1n)).toBe("0");
    expect(formatKub(1n, 18)).toBe("0.000000000000000001");
  });

  it("groups thousands", () => {
    expect(formatKub(5_668_489n * E18)).toBe("5,668,489");
    expect(formatKub(1234n * E18 + 5n * 10n ** 17n)).toBe("1,234.5");
  });

  it("respects maxFrac and negatives", () => {
    expect(formatKub(1234567890000000000n, 2)).toBe("1.23");
    expect(formatKub(1234567890000000000n, 0)).toBe("1");
    expect(formatKub(-1500000000000000000n)).toBe("-1.5");
    expect(formatKub(-1n)).toBe("0");
  });
});

describe("parseKub", () => {
  it("parses decimals to wei", () => {
    expect(parseKub("1.5")).toBe(1500000000000000000n);
    expect(parseKub("0")).toBe(0n);
    expect(parseKub("10")).toBe(10n * E18);
    expect(parseKub(".5")).toBe(5n * 10n ** 17n);
    expect(parseKub(" 0.05 ")).toBe(5n * 10n ** 16n);
    expect(parseKub("0.000000000000000001")).toBe(1n);
    expect(parseKub("1,234.5")).toBe(1234n * E18 + 5n * 10n ** 17n);
  });

  it("round-trips formatKub output", () => {
    for (const w of [0n, 1n * E18, 1234567890000000000n, 5_668_489n * E18 + 123n * 10n ** 14n]) {
      expect(parseKub(formatKub(w, 18))).toBe(w);
    }
  });

  it("throws on invalid / negative / over-precise input", () => {
    for (const bad of ["abc", "", " ", "-1", "1.2.3", "1e18", "0x10", "1,5", "12,34", "1.", "+1", "1 000"]) {
      expect(() => parseKub(bad), bad).toThrow();
    }
    expect(() => parseKub("0.0000000000000000001")).toThrow(/18 decimal/);
  });
});

describe("gwei helpers", () => {
  it("formatGwei", () => {
    expect(formatGwei(25_000_000_000n)).toBe("25");
    expect(formatGwei(25_500_000_000n)).toBe("25.5");
    expect(formatGwei(1n)).toBe("0.000000001");
    expect(formatGwei(0n)).toBe("0");
  });

  it("gweiToWei from string and number", () => {
    expect(gweiToWei("50")).toBe(50_000_000_000n);
    expect(gweiToWei(50)).toBe(50_000_000_000n);
    expect(gweiToWei("25.5")).toBe(25_500_000_000n);
    expect(gweiToWei(0.5)).toBe(500_000_000n);
    expect(() => gweiToWei(-1)).toThrow();
    expect(() => gweiToWei(Number.NaN)).toThrow();
    expect(() => gweiToWei("abc")).toThrow();
    expect(() => gweiToWei("0.0000000001")).toThrow();
  });
});

describe("shortAddr", () => {
  it("shortens addresses", () => {
    expect(shortAddr("0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20")).toBe("0x89a5…fa20");
    expect(shortAddr("0x1234")).toBe("0x1234");
  });
});
