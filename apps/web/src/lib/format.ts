import "server-only";
import { explorerAddressUrl, explorerTxUrl } from "@kubstake/core/browser";
import { env } from "./env";

// Server-side display helpers. Client components get pre-formatted strings as props (bigint/Date can't
// cross the RSC boundary as-is); "use client" code that needs pure helpers imports @kubstake/core/browser.
export { formatKub, formatGwei, shortAddr, explorerTxUrl, explorerAddressUrl } from "@kubstake/core/browser";

type DateInput = Date | string | number | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d === null || d === undefined) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `APP_TIMEZONE` date-time in Thai, e.g. "5 พ.ย. 2569 14:03:22"; "-" for null/invalid. */
export function formatDateTime(d: DateInput, timeZone: string = env.APP_TIMEZONE): string {
  const date = toDate(d);
  if (!date) return "-";
  return new Intl.DateTimeFormat("th-TH", { timeZone, dateStyle: "medium", timeStyle: "medium" }).format(date);
}

/** Duration in Thai, two largest units: 45 → "45 วินาที", 3_900 → "1 ชั่วโมง 5 นาที", 200_000 → "2 วัน 7 ชั่วโมง". */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec)) return "ไม่มีกำหนด";
  const s = Math.max(0, Math.round(totalSec));
  const units: [number, string][] = [
    [86_400, "วัน"],
    [3_600, "ชั่วโมง"],
    [60, "นาที"],
    [1, "วินาที"],
  ];
  const parts: string[] = [];
  let rest = s;
  for (const [size, label] of units) {
    const n = Math.floor(rest / size);
    if (n > 0 || (size === 1 && parts.length === 0)) parts.push(`${n} ${label}`);
    rest -= n * size;
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

/** Relative time in Thai: "12 วินาทีก่อน", "3 ชั่วโมงก่อน", "อีก 5 นาที"; "-" for null/invalid. */
export function relativeTime(d: DateInput, now: Date = new Date()): string {
  const date = toDate(d);
  if (!date) return "-";
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(diffSec) < 5) return "เมื่อสักครู่";
  const abs = Math.abs(diffSec);
  const [n, unit] =
    abs < 60
      ? [abs, "วินาที"]
      : abs < 3_600
        ? [Math.floor(abs / 60), "นาที"]
        : abs < 86_400
          ? [Math.floor(abs / 3_600), "ชั่วโมง"]
          : [Math.floor(abs / 86_400), "วัน"];
  return diffSec < 0 ? `${n} ${unit}ก่อน` : `อีก ${n} ${unit}`;
}

/** kubscan tx link using EXPLORER_URL. */
export function txUrl(hash: string): string {
  return explorerTxUrl(env.EXPLORER_URL, hash);
}

/** kubscan address link using EXPLORER_URL. */
export function addressUrl(address: string): string {
  return explorerAddressUrl(env.EXPLORER_URL, address);
}
