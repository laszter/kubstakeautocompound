import { Cron } from "croner";

// `schedule` trigger mode: 5-field cron + IANA timezone (APP_TIMEZONE, default Asia/Bangkok).
// `new Cron(expr, options)` without a callback never starts a timer — evaluation only, no side effects.

export type SchedulePreset =
  | { kind: "every_hours"; n: number }
  | { kind: "every_days"; n: number; hh: number; mm: number }
  | { kind: "daily"; hh: number; mm: number }
  | { kind: "weekly"; dow: 0 | 1 | 2 | 3 | 4 | 5 | 6; hh: number; mm: number }
  | { kind: "custom"; expr: string };

function assertInt(v: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${what} must be an integer in ${min}..${max}`);
  }
}

const normalizeExpr = (expr: string) => expr.trim().split(/\s+/).join(" ");

/**
 * Preset → 5-field cron. every_hours: n 1..23 → "0 *\/n * * *"; n = 24·k (k ≤ 7) → "0 0 *\/k * *"
 * (cron cannot express other periods ≥ 24h). every_days → "mm HH *\/n * *", daily → "mm HH * * *",
 * weekly → "mm HH * * d", custom → trimmed expr. Throws RangeError on out-of-range fields.
 */
export function presetToCron(p: SchedulePreset): string {
  switch (p.kind) {
    case "every_hours": {
      if (Number.isInteger(p.n) && p.n >= 24 && p.n <= 168 && p.n % 24 === 0) {
        return `0 0 */${p.n / 24} * *`;
      }
      assertInt(p.n, 1, 23, "every_hours.n (or a multiple of 24 up to 168)");
      return `0 */${p.n} * * *`;
    }
    case "every_days":
      assertInt(p.n, 1, 31, "every_days.n");
      assertInt(p.hh, 0, 23, "hh");
      assertInt(p.mm, 0, 59, "mm");
      return `${p.mm} ${p.hh} */${p.n} * *`;
    case "daily":
      assertInt(p.hh, 0, 23, "hh");
      assertInt(p.mm, 0, 59, "mm");
      return `${p.mm} ${p.hh} * * *`;
    case "weekly":
      assertInt(p.dow, 0, 6, "dow");
      assertInt(p.hh, 0, 23, "hh");
      assertInt(p.mm, 0, 59, "mm");
      return `${p.mm} ${p.hh} * * ${p.dow}`;
    case "custom":
      return normalizeExpr(p.expr);
  }
}

function makeCron(expr: string, timezone: string): Cron {
  return new Cron(normalizeExpr(expr), { timezone, mode: "5-part" });
}

/** Runs inspected for the spacing check (more than the 5 returned, to catch irregular patterns). */
const SPACING_SAMPLE = 24;

/**
 * Valid iff: 5 fields, parseable by croner in `timezone`, has upcoming runs, and every pair of consecutive
 * upcoming runs is ≥ minSpacingSec apart. Returns the next 5 runs for preview.
 */
export function validateCron(
  expr: string,
  timezone: string,
  minSpacingSec = 3600,
): { ok: true; nextRuns: Date[] } | { ok: false; error: string } {
  const normalized = typeof expr === "string" ? normalizeExpr(expr) : "";
  if (normalized.split(" ").length !== 5 || normalized === "") {
    return { ok: false, error: "cron ต้องมี 5 ฟิลด์ (นาที ชั่วโมง วัน เดือน วันในสัปดาห์)" };
  }
  let runs: Date[];
  try {
    runs = makeCron(normalized, timezone).nextRuns(SPACING_SAMPLE);
  } catch (err) {
    return { ok: false, error: `cron ไม่ถูกต้อง: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (runs.length === 0) return { ok: false, error: "cron นี้ไม่มีรอบถัดไป" };
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1];
    const cur = runs[i];
    if (prev && cur && cur.getTime() - prev.getTime() < minSpacingSec * 1000) {
      return {
        ok: false,
        error: `รอบห่างกันน้อยกว่า ${Math.round(minSpacingSec / 60)} นาที (ขั้นต่ำ ${minSpacingSec / 3600} ชั่วโมง)`,
      };
    }
  }
  return { ok: true, nextRuns: runs.slice(0, 5) };
}

/** Next run strictly after `from`, or null if none / invalid expression or timezone. */
export function nextRunAt(expr: string, timezone: string, from = new Date()): Date | null {
  try {
    return makeCron(expr, timezone).nextRun(from);
  } catch {
    return null;
  }
}

const THAI_DOW = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const isNum = (s: string | undefined, max: number): s is string =>
  s !== undefined && /^\d+$/.test(s) && Number(s) <= max;

/** Thai description of the preset shapes (e.g. "ทุก 6 ชั่วโมง"); anything else → the expression itself. */
export function describeCron(expr: string): string {
  const e = typeof expr === "string" ? normalizeExpr(expr) : "";
  const f = e.split(" ");
  if (f.length !== 5) return e;
  const [mi, hr, dom, mon, dow] = f;
  if (mon !== "*") return e;

  // Hourly shapes: "M * * * *" / "M */N * * *"
  if (isNum(mi, 59) && dom === "*" && dow === "*") {
    if (hr === "*") return mi === "0" ? "ทุกชั่วโมง" : `ทุกชั่วโมง ที่นาที ${pad2(Number(mi))}`;
    const step = /^\*\/(\d+)$/.exec(hr ?? "");
    if (step) {
      const n = Number(step[1]);
      return mi === "0" ? `ทุก ${n} ชั่วโมง` : `ทุก ${n} ชั่วโมง ที่นาที ${pad2(Number(mi))}`;
    }
  }
  if (!isNum(mi, 59) || !isNum(hr, 23)) return e;
  const at = `เวลา ${pad2(Number(hr))}:${pad2(Number(mi))}`;
  if (dom === "*" && dow === "*") return `ทุกวัน ${at}`;
  const dayStep = /^\*\/(\d+)$/.exec(dom ?? "");
  if (dayStep && dow === "*") return `ทุก ${Number(dayStep[1])} วัน ${at}`;
  if (dom === "*" && isNum(dow, 7)) return `ทุกสัปดาห์ วัน${THAI_DOW[Number(dow)]} ${at}`;
  return e;
}
