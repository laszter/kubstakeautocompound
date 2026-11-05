import { describe, expect, it } from "vitest";
import { describeCron, nextRunAt, presetToCron, validateCron } from "./schedule";

const TZ = "Asia/Bangkok";

describe("presetToCron", () => {
  it("every_hours", () => {
    expect(presetToCron({ kind: "every_hours", n: 6 })).toBe("0 */6 * * *");
    expect(presetToCron({ kind: "every_hours", n: 1 })).toBe("0 */1 * * *");
    expect(presetToCron({ kind: "every_hours", n: 24 })).toBe("0 0 */1 * *");
    expect(presetToCron({ kind: "every_hours", n: 48 })).toBe("0 0 */2 * *");
    expect(() => presetToCron({ kind: "every_hours", n: 0 })).toThrow(RangeError);
    expect(() => presetToCron({ kind: "every_hours", n: 30 })).toThrow(RangeError);
    expect(() => presetToCron({ kind: "every_hours", n: 2.5 })).toThrow(RangeError);
  });

  it("every_days / daily / weekly / custom", () => {
    expect(presetToCron({ kind: "every_days", n: 3, hh: 9, mm: 30 })).toBe("30 9 */3 * *");
    expect(presetToCron({ kind: "daily", hh: 21, mm: 5 })).toBe("5 21 * * *");
    expect(presetToCron({ kind: "weekly", dow: 1, hh: 8, mm: 0 })).toBe("0 8 * * 1");
    expect(presetToCron({ kind: "custom", expr: "  15   */4 * *  * " })).toBe("15 */4 * * *");
    expect(() => presetToCron({ kind: "daily", hh: 24, mm: 0 })).toThrow(RangeError);
    expect(() => presetToCron({ kind: "daily", hh: 1, mm: 60 })).toThrow(RangeError);
    expect(() => presetToCron({ kind: "every_days", n: 0, hh: 1, mm: 0 })).toThrow(RangeError);
  });

  it("every preset passes validateCron", () => {
    for (const expr of [
      presetToCron({ kind: "every_hours", n: 1 }),
      presetToCron({ kind: "every_hours", n: 6 }),
      presetToCron({ kind: "every_hours", n: 168 }),
      presetToCron({ kind: "every_days", n: 2, hh: 3, mm: 15 }),
      presetToCron({ kind: "daily", hh: 9, mm: 0 }),
      presetToCron({ kind: "weekly", dow: 0, hh: 23, mm: 59 }),
    ]) {
      expect(validateCron(expr, TZ).ok, expr).toBe(true);
    }
  });
});

describe("validateCron", () => {
  it("rejects schedules more frequent than 1h", () => {
    const r = validateCron("*/5 * * * *", TZ);
    expect(r.ok).toBe(false);
    expect(validateCron("0,30 * * * *", TZ).ok).toBe(false);
    expect(validateCron("0 9,10 * * *", TZ).ok).toBe(true);
    expect(validateCron("0 9 * * *", TZ, 2 * 86_400).ok).toBe(false);
  });

  it("accepts '0 */6 * * *' in Asia/Bangkok and returns 5 next runs 6h apart", () => {
    const r = validateCron("0 */6 * * *", TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextRuns).toHaveLength(5);
    for (let i = 1; i < r.nextRuns.length; i++) {
      expect(r.nextRuns[i]!.getTime() - r.nextRuns[i - 1]!.getTime()).toBe(6 * 3600 * 1000);
    }
  });

  it("rejects unparseable / wrong field count / invalid timezone / never-running", () => {
    expect(validateCron("abc", TZ).ok).toBe(false);
    expect(validateCron("", TZ).ok).toBe(false);
    expect(validateCron("0 0 */6 * * *", TZ).ok).toBe(false); // 6 fields
    expect(validateCron("61 * * * *", TZ).ok).toBe(false);
    expect(validateCron("@daily", TZ).ok).toBe(false);
    expect(validateCron("0 9 * * *", "Mars/Olympus").ok).toBe(false);
    expect(validateCron("0 0 31 2 *", TZ).ok).toBe(false);
  });
});

describe("nextRunAt", () => {
  it("09:00 Bangkok after 01:00Z (08:00 local) → 02:00Z same day", () => {
    expect(nextRunAt("0 9 * * *", TZ, new Date("2026-11-04T01:00:00Z"))?.toISOString()).toBe("2026-11-04T02:00:00.000Z");
  });

  it("strictly after `from`, and null for invalid input", () => {
    expect(nextRunAt("0 9 * * *", TZ, new Date("2026-11-04T02:00:00Z"))?.toISOString()).toBe("2026-11-05T02:00:00.000Z");
    expect(nextRunAt("nope", TZ)).toBeNull();
    expect(nextRunAt("0 9 * * *", "Bad/Zone")).toBeNull();
  });

  it("weekly preset in Bangkok", () => {
    // 2026-11-04 is a Wednesday; next Monday 08:00 Bangkok = 2026-11-09T01:00Z
    expect(nextRunAt("0 8 * * 1", TZ, new Date("2026-11-04T01:00:00Z"))?.toISOString()).toBe("2026-11-09T01:00:00.000Z");
  });
});

describe("describeCron", () => {
  it("describes preset shapes in Thai", () => {
    expect(describeCron("0 */6 * * *")).toBe("ทุก 6 ชั่วโมง");
    expect(describeCron("0 * * * *")).toBe("ทุกชั่วโมง");
    expect(describeCron(presetToCron({ kind: "every_hours", n: 1 }))).toBe("ทุก 1 ชั่วโมง");
    expect(describeCron(presetToCron({ kind: "every_days", n: 1, hh: 7, mm: 0 }))).toBe("ทุก 1 วัน เวลา 07:00");
    expect(describeCron("30 9 */3 * *")).toBe("ทุก 3 วัน เวลา 09:30");
    expect(describeCron("5 21 * * *")).toBe("ทุกวัน เวลา 21:05");
    expect(describeCron("0 8 * * 1")).toBe("ทุกสัปดาห์ วันจันทร์ เวลา 08:00");
  });

  it("falls back to the expression", () => {
    expect(describeCron("0 9 1 1 *")).toBe("0 9 1 1 *");
    expect(describeCron("0 9-17 * * 1-5")).toBe("0 9-17 * * 1-5");
    expect(describeCron("garbage")).toBe("garbage");
  });
});
