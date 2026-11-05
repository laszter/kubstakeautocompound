// Amount formatting/parsing in pure BigInt — never floats for money.

const KUB_DECIMALS = 18;
const GWEI_DECIMALS = 9;

function formatUnitsTruncated(value: bigint, decimals: number, maxFrac: number, group: boolean): string {
  const frac = Math.max(0, Math.min(decimals, Math.floor(Number.isFinite(maxFrac) ? maxFrac : 0)));
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  const fracPart = abs % base;
  const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, frac).replace(/0+$/, "");
  let intStr = intPart.toString();
  if (group) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fracStr ? `${intStr}.${fracStr}` : intStr;
  return neg && (intPart > 0n || fracStr !== "") ? `-${body}` : body;
}

/** Strict decimal → integer units. Accepts "1", "1.5", ".5", "1,234.5" (correct thousands grouping only). */
function parseUnitsStrict(input: string, decimals: number, what: string): bigint {
  if (typeof input !== "string") throw new Error(`Invalid ${what} amount`);
  const s = input.trim();
  const m = /^(?:(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?|\.(\d+))$/.exec(s);
  if (!m) throw new Error(`Invalid ${what} amount (expected a non-negative decimal like 1.5)`);
  const intDigits = (m[1] ?? "0").replace(/,/g, "");
  const fracDigits = m[2] ?? m[3] ?? "";
  if (fracDigits.length > decimals) {
    throw new Error(`Invalid ${what} amount: at most ${decimals} decimal places`);
  }
  return BigInt(intDigits) * 10n ** BigInt(decimals) + BigInt(fracDigits.padEnd(decimals, "0") || "0");
}

/**
 * wei → KUB string, truncated (not rounded) to `maxFrac` decimals, trailing zeros removed,
 * thousands grouped with ",". e.g. 1234567890000000000n → "1.2345"; 5668489n*10n**18n → "5,668,489".
 * Output round-trips through `parseKub` (up to the truncation).
 */
export function formatKub(wei: bigint, maxFrac = 4): string {
  return formatUnitsTruncated(wei, KUB_DECIMALS, maxFrac, true);
}

/** KUB decimal string → wei. Throws on empty/invalid/negative input or > 18 decimals. */
export function parseKub(s: string): bigint {
  return parseUnitsStrict(s, KUB_DECIMALS, "KUB");
}

/** wei → gwei string (up to 9 decimals, trailing zeros removed, no grouping). 25_000_000_000n → "25". */
export function formatGwei(wei: bigint): string {
  return formatUnitsTruncated(wei, GWEI_DECIMALS, GWEI_DECIMALS, false);
}

/** gwei (string or number) → wei. Throws on invalid/negative/non-finite input. */
export function gweiToWei(gwei: string | number): bigint {
  if (typeof gwei === "number") {
    if (!Number.isFinite(gwei) || gwei < 0) throw new Error("Invalid gwei amount");
    const s = Number.isInteger(gwei) ? gwei.toString() : gwei.toFixed(GWEI_DECIMALS);
    if (/e/i.test(s)) throw new Error("Invalid gwei amount (too large)");
    return parseUnitsStrict(s, GWEI_DECIMALS, "gwei");
  }
  return parseUnitsStrict(gwei, GWEI_DECIMALS, "gwei");
}

/** "0x1234567890abcdef..." → "0x1234…cdef". Short inputs are returned unchanged. */
export function shortAddr(a: string): string {
  if (typeof a !== "string" || a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
