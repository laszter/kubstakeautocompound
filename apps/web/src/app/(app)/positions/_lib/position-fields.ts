import { formatKub, presetToCron, type SchedulePreset } from "@kubstake/core/browser";
import type { ActionResult } from "@/lib/action-result";

// Shared by the position pages (server), their actions ("use server") and the forms (client):
// pure — no server imports, core helpers only via @kubstake/core/browser.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Trigger modes
// ---------------------------------------------------------------------------
export const POSITION_MODES = ["optimal", "threshold", "schedule"] as const;
export type PositionMode = (typeof POSITION_MODES)[number];

export const MODE_LABELS: Record<PositionMode, string> = {
  optimal: "Optimal",
  threshold: "Threshold",
  schedule: "Schedule",
};

/** threshold mode lower bound (KUB). */
export const THRESHOLD_MIN_KUB = "0.01";

export const SCHEDULE_KINDS = ["every_hours", "every_days", "daily", "weekly", "custom"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  every_hours: "ทุก N ชั่วโมง",
  every_days: "ทุก N วัน เวลา HH:mm",
  daily: "ทุกวัน เวลา HH:mm",
  weekly: "ทุกสัปดาห์ วัน + เวลา HH:mm",
  custom: "Custom cron (5 ฟิลด์)",
};

/** Index = cron day-of-week (0 = Sunday). */
export const DOW_LABELS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"] as const;

/** every_hours accepts 1–23, or a multiple of 24 up to 168 (→ day step) — same rule as core presetToCron. */
export function isValidEveryHours(n: number): boolean {
  return Number.isInteger(n) && ((n >= 1 && n <= 23) || (n >= 24 && n <= 168 && n % 24 === 0));
}

// ---------------------------------------------------------------------------
// Auto-compound settings form
// ---------------------------------------------------------------------------
export const SETTINGS_FORM_FIELDS = [
  "mode",
  "thresholdKub",
  "scheduleKind",
  "everyHours",
  "everyDays",
  "time",
  "dow",
  "cron",
  "minRewardKub",
] as const;
export type PositionSettingsField = (typeof SETTINGS_FORM_FIELDS)[number];
export type PositionSettingsValues = Record<PositionSettingsField, string>;
export type ScheduleValues = Pick<PositionSettingsValues, "scheduleKind" | "everyHours" | "everyDays" | "time" | "dow" | "cron">;

/** Action state: result + the values to keep showing in the form. */
export type PositionSettingsState = ActionResult & { values?: PositionSettingsValues };

/** Delegate / undelegate / create forms: result + the typed amount (kept on error, cleared on success). */
export type AmountFormState = ActionResult & { values?: { amountKub: string } };

export type NewPositionValues = { walletId: string; validatorId: string; amountKub: string };
export type NewPositionState = ActionResult & { values?: NewPositionValues };

const DEFAULT_SCHEDULE: ScheduleValues = {
  scheduleKind: "daily",
  everyHours: "6",
  everyDays: "2",
  time: "09:00",
  dow: "1",
  cron: "",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const normalizeExpr = (expr: string) => expr.trim().split(/\s+/).join(" ");

function parseIntStrict(s: string): number | null {
  const t = s.trim();
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

/** "HH:mm" (24h) → numbers, or null. */
export function parseTime(s: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh <= 23 && mm <= 59 ? { hh, mm } : null;
}

export type ScheduleCronResult =
  | { ok: true; preset: SchedulePreset; expr: string }
  | { ok: false; field: PositionSettingsField; error: string };

/**
 * Schedule form strings → core SchedulePreset → 5-field cron via presetToCron. Does not check the timezone
 * or the ≥ 1h spacing (run validateCron(expr, APP_TIMEZONE) on the result for that).
 */
export function scheduleValuesToCron(v: ScheduleValues): ScheduleCronResult {
  let preset: SchedulePreset;
  switch (v.scheduleKind) {
    case "every_hours": {
      const n = parseIntStrict(v.everyHours);
      if (n === null || !isValidEveryHours(n)) {
        return { ok: false, field: "everyHours", error: "N ต้องเป็น 1–23 หรือ 24, 48, 72, …, 168 (ทวีคูณของ 24)" };
      }
      preset = { kind: "every_hours", n };
      break;
    }
    case "every_days": {
      const n = parseIntStrict(v.everyDays);
      if (n === null || n < 1 || n > 31) return { ok: false, field: "everyDays", error: "N ต้องเป็นจำนวนเต็ม 1–31" };
      const t = parseTime(v.time);
      if (!t) return { ok: false, field: "time", error: "เวลาต้องอยู่ในรูปแบบ HH:mm (24 ชม.)" };
      preset = { kind: "every_days", n, ...t };
      break;
    }
    case "daily": {
      const t = parseTime(v.time);
      if (!t) return { ok: false, field: "time", error: "เวลาต้องอยู่ในรูปแบบ HH:mm (24 ชม.)" };
      preset = { kind: "daily", ...t };
      break;
    }
    case "weekly": {
      const d = parseIntStrict(v.dow);
      if (d === null || d > 6) return { ok: false, field: "dow", error: "เลือกวันในสัปดาห์" };
      const t = parseTime(v.time);
      if (!t) return { ok: false, field: "time", error: "เวลาต้องอยู่ในรูปแบบ HH:mm (24 ชม.)" };
      preset = { kind: "weekly", dow: d as 0 | 1 | 2 | 3 | 4 | 5 | 6, ...t };
      break;
    }
    case "custom": {
      const expr = normalizeExpr(v.cron);
      if (!expr) return { ok: false, field: "cron", error: "กรุณากรอก cron expression 5 ฟิลด์ เช่น 0 9 * * 1-5" };
      if (expr.length > 120) return { ok: false, field: "cron", error: "cron expression ยาวเกินไป" };
      preset = { kind: "custom", expr };
      break;
    }
    default:
      return { ok: false, field: "scheduleKind", error: "เลือกรูปแบบเวลา" };
  }
  try {
    return { ok: true, preset, expr: presetToCron(preset) };
  } catch (err) {
    const field: PositionSettingsField =
      preset.kind === "every_hours" ? "everyHours" : preset.kind === "custom" ? "cron" : "time";
    return { ok: false, field, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Stored cron → the preset form fields that reproduce it exactly; anything else → custom. */
export function cronToScheduleValues(expr: string | null): ScheduleValues {
  if (!expr) return { ...DEFAULT_SCHEDULE };
  const e = normalizeExpr(expr);
  const candidates: ScheduleValues[] = [];
  let m: RegExpExecArray | null;
  if ((m = /^0 \*\/(\d+) \* \* \*$/.exec(e))) {
    candidates.push({ ...DEFAULT_SCHEDULE, scheduleKind: "every_hours", everyHours: m[1]! });
  }
  if ((m = /^(\d+) (\d+) \*\/(\d+) \* \*$/.exec(e))) {
    candidates.push({ ...DEFAULT_SCHEDULE, scheduleKind: "every_days", everyDays: m[3]!, time: `${pad2(+m[2]!)}:${pad2(+m[1]!)}` });
  }
  if ((m = /^(\d+) (\d+) \* \* \*$/.exec(e))) {
    candidates.push({ ...DEFAULT_SCHEDULE, scheduleKind: "daily", time: `${pad2(+m[2]!)}:${pad2(+m[1]!)}` });
  }
  if ((m = /^(\d+) (\d+) \* \* ([0-6])$/.exec(e))) {
    candidates.push({ ...DEFAULT_SCHEDULE, scheduleKind: "weekly", dow: m[3]!, time: `${pad2(+m[2]!)}:${pad2(+m[1]!)}` });
  }
  for (const c of candidates) {
    const r = scheduleValuesToCron(c);
    if (r.ok && r.expr === e) return c;
  }
  return { ...DEFAULT_SCHEDULE, scheduleKind: "custom", cron: e };
}

/** Initial settings-form values from a position row. */
export function positionToSettingsValues(
  p: { strategy: PositionMode; thresholdWei: bigint | null; cronExpr: string | null; minRewardWei: bigint | null },
  defaultThresholdKub: string,
): PositionSettingsValues {
  return {
    mode: p.strategy,
    thresholdKub: p.thresholdWei !== null ? formatKub(p.thresholdWei, 18) : defaultThresholdKub,
    ...cronToScheduleValues(p.cronExpr),
    minRewardKub: p.minRewardWei !== null ? formatKub(p.minRewardWei, 18) : "",
  };
}

/** Reads the settings form fields from FormData (strings, length-capped). */
export function readSettingsValues(formData: FormData): PositionSettingsValues {
  const out = {} as PositionSettingsValues;
  for (const key of SETTINGS_FORM_FIELDS) {
    const v = formData.get(key);
    out[key] = typeof v === "string" ? v.slice(0, 200) : "";
  }
  return out;
}
