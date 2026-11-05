"use server";

import { formatKub, nextRunAt, parseKub, validateCron } from "@kubstake/core/browser";
import { actions, enqueueAction, getPositionWithRelations, positions, type ActionType } from "@kubstake/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { getWorkerStatus } from "@/lib/worker";
import { effectiveGasPrice, isValidatorDelegatable, maxDelegatableWei } from "../_lib/hints";
import {
  isUuid,
  readSettingsValues,
  scheduleValuesToCron,
  THRESHOLD_MIN_KUB,
  type AmountFormState,
  type PositionSettingsState,
} from "../_lib/position-fields";
import { getOpenActionTypes, getSettingsOrNull, OPEN_ACTION_STATUSES } from "../_lib/queries";

// Web only ENQUEUES rows in `actions`; the worker signs/sends. Every export: requireSession() first
// (never inside try/catch — it redirects by throwing), then checks the position exists.

const NOT_FOUND = "ไม่พบ position นี้ (อาจถูกลบไปแล้ว)";
const DB_ERROR = "ทำรายการไม่สำเร็จ: ฐานข้อมูลไม่พร้อม — ลองใหม่อีกครั้ง";

function logError(where: string, err: unknown): void {
  console.error(`[positions:${where}] ${err instanceof Error ? err.message : String(err)}`);
}

function revalidatePosition(id: string): void {
  revalidatePath(`/positions/${id}`);
  revalidatePath("/");
}

const TYPE_LABEL: Record<Exclude<ActionType, "sync_validators">, string> = {
  delegate: "delegate",
  undelegate: "ถอน (undelegate)",
  claim: "claim reward",
  compound: "compound",
};

/** Queues one action after the shared guards (worker alive, no open action of the same type). */
async function enqueueChecked(
  positionId: string,
  type: Exclude<ActionType, "sync_validators">,
  amountWei: bigint | null,
  successMessage: string,
): Promise<ActionResult> {
  const worker = await getWorkerStatus();
  if (!worker.fresh) return fail("worker ไม่ตอบสนอง — ยังสั่งงานไม่ได้ (ตรวจว่า worker container ทำงานอยู่)");
  const { created } = await enqueueAction(getDb(), { type, positionId, amountWei, requestedBy: "ui" });
  revalidatePosition(positionId);
  if (!created) return fail(`มีคำสั่งค้างอยู่แล้ว (${TYPE_LABEL[type]} รอ worker ดำเนินการ)`);
  return ok(successMessage);
}

const amountSchema = z
  .string()
  .trim()
  .min(1, "กรุณากรอกจำนวน KUB")
  .transform((v, ctx) => {
    try {
      return parseKub(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "ต้องเป็นจำนวน KUB เช่น 10 หรือ 1.5" });
      return z.NEVER;
    }
  })
  .pipe(z.bigint().positive("จำนวนต้องมากกว่า 0"));

function readAmount(formData: FormData): string {
  const v = formData.get("amountKub");
  return typeof v === "string" ? v.slice(0, 64) : "";
}

/** Delegate (stake) more KUB: ≤ balance − reserve − gas, and principal + amount ≥ minDelegated. */
export async function enqueueDelegate(
  positionId: string,
  _prev: AmountFormState | null,
  formData: FormData,
): Promise<AmountFormState> {
  await requireSession();
  const amountKub = readAmount(formData);
  const values = { amountKub };
  if (!isUuid(positionId)) return { ...fail(NOT_FOUND), values };

  const parsed = amountSchema.safeParse(amountKub);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "จำนวนไม่ถูกต้อง";
    return { ...fail(msg, { amountKub: msg }), values };
  }
  const amountWei = parsed.data;

  try {
    const pos = await getPositionWithRelations(getDb(), positionId);
    if (!pos) return { ...fail(NOT_FOUND), values };
    if (!isValidatorDelegatable(pos.validator)) {
      return { ...fail("validator นี้ปิดรับ delegate (delegation ปิด / paused / official pool / ไม่ active) — ถอนหรือ claim ได้อย่างเดียว"), values };
    }
    const min = pos.validator.minDelegatedWei;
    if (pos.principalWei + amountWei < min) {
      const msg = `รวมกับเงินต้นเดิมต้องไม่น้อยกว่า minDelegated ${formatKub(min, 18)} KUB`;
      return { ...fail(msg, { amountKub: msg }), values };
    }
    const settings = await getSettingsOrNull();
    if (!settings) return { ...fail("ยังไม่มี app_settings — รัน migrate/worker ก่อน"), values };
    const worker = await getWorkerStatus();
    const gas = effectiveGasPrice(worker.heartbeat?.gasPriceWei);
    const max = maxDelegatableWei(pos.wallet.balanceWei, settings.gasReserveWei, gas.wei);
    if (max === null) return { ...fail("ยังไม่ทราบยอดคงเหลือของ wallet — รอ worker อ่านยอด (ทุก tick)"), values };
    if (amountWei > max) {
      const msg = `เกินยอดที่ใช้ได้ ${formatKub(max)} KUB (ยอดคงเหลือ − gas reserve ${formatKub(settings.gasReserveWei)} KUB − ค่า gas)`;
      return { ...fail(msg, { amountKub: msg }), values };
    }
    const r = await enqueueChecked(positionId, "delegate", amountWei, `ส่งคำสั่ง delegate ${formatKub(amountWei)} KUB แล้ว — รอ worker`);
    return r.ok ? { ...r, values: { amountKub: "" } } : { ...r, values };
  } catch (err) {
    logError("delegate", err);
    return { ...fail(DB_ERROR), values };
  }
}

/** Undelegate: amount ≤ principal; `all=true` → amount = principal. Contract exits fully if the rest < minDelegated. */
export async function enqueueUndelegate(
  positionId: string,
  _prev: AmountFormState | null,
  formData: FormData,
): Promise<AmountFormState> {
  await requireSession();
  const all = formData.get("all") === "true";
  const amountKub = all ? "" : readAmount(formData);
  const values = { amountKub };
  if (!isUuid(positionId)) return { ...fail(NOT_FOUND), values };

  let amountWei: bigint | null = null;
  if (!all) {
    const parsed = amountSchema.safeParse(amountKub);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "จำนวนไม่ถูกต้อง";
      return { ...fail(msg, { amountKub: msg }), values };
    }
    amountWei = parsed.data;
  }

  try {
    const pos = await getPositionWithRelations(getDb(), positionId);
    if (!pos) return { ...fail(NOT_FOUND), values };
    if (pos.principalWei <= 0n) return { ...fail("ยังไม่มีเงินต้นให้ถอน (principal = 0)"), values };
    const amount = all ? pos.principalWei : (amountWei as bigint);
    if (amount > pos.principalWei) {
      const msg = `ถอนได้ไม่เกินเงินต้น ${formatKub(pos.principalWei, 18)} KUB`;
      return { ...fail(msg, { amountKub: msg }), values };
    }
    const rest = pos.principalWei - amount;
    const fullExit = rest > 0n && rest < pos.validator.minDelegatedWei;
    const msg =
      all || rest === 0n
        ? `ส่งคำสั่งถอนทั้งหมด ${formatKub(amount)} KUB แล้ว — รอ worker`
        : fullExit
          ? `ส่งคำสั่งถอน ${formatKub(amount)} KUB แล้ว — ส่วนที่เหลือต่ำกว่า minDelegated จึงจะถูกถอนทั้งหมด`
          : `ส่งคำสั่งถอน ${formatKub(amount)} KUB แล้ว — รอ worker`;
    const r = await enqueueChecked(positionId, "undelegate", amount, msg);
    return r.ok ? { ...r, values: { amountKub: "" } } : { ...r, values };
  } catch (err) {
    logError("undelegate", err);
    return { ...fail(DB_ERROR), values };
  }
}

async function enqueueSimple(positionId: string, type: "claim" | "compound", message: string): Promise<ActionResult> {
  if (!isUuid(positionId)) return fail(NOT_FOUND);
  try {
    const pos = await getPositionWithRelations(getDb(), positionId);
    if (!pos) return fail(NOT_FOUND);
    return await enqueueChecked(positionId, type, null, message);
  } catch (err) {
    logError(type, err);
    return fail(DB_ERROR);
  }
}

/** Claim pending reward to the wallet. */
export async function enqueueClaim(positionId: string): Promise<ActionResult> {
  await requireSession();
  return enqueueSimple(positionId, "claim", "ส่งคำสั่ง claim reward แล้ว — รอ worker");
}

/** Compound now (ignores the mode threshold / min interval / max gas price; still keeps the gas reserve). */
export async function enqueueCompoundNow(positionId: string): Promise<ActionResult> {
  await requireSession();
  return enqueueSimple(positionId, "compound", "ส่งคำสั่ง compound แล้ว — รอ worker");
}

const optionalKub = (min: bigint, minMsg: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      try {
        return parseKub(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "ต้องเป็นจำนวน KUB เช่น 0.5" });
        return z.NEVER;
      }
    })
    .refine((v) => v === null || v >= min, minMsg);

const settingsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("optimal") }),
  z.object({
    mode: z.literal("threshold"),
    thresholdKub: optionalKub(parseKub(THRESHOLD_MIN_KUB), `ต้องไม่น้อยกว่า ${THRESHOLD_MIN_KUB} KUB`).refine(
      (v) => v !== null,
      "กรุณากรอก threshold (KUB)",
    ),
  }),
  z.object({
    mode: z.literal("schedule"),
    minRewardKub: optionalKub(0n, "ต้องไม่ติดลบ"),
  }),
]);

/**
 * Saves the trigger mode. schedule → presetToCron + validateCron(APP_TIMEZONE) must pass → cron_expr + next_run_at;
 * threshold → threshold_wei (cron cleared); optimal → clears both. Always next_check_at = now() so the worker re-evaluates.
 */
export async function updatePositionSettings(
  positionId: string,
  _prev: PositionSettingsState | null,
  formData: FormData,
): Promise<PositionSettingsState> {
  await requireSession();
  const values = readSettingsValues(formData);
  if (!isUuid(positionId)) return { ...fail(NOT_FOUND), values };

  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  const s = parsed.data;

  let patch: Partial<typeof positions.$inferInsert>;
  let message: string;
  if (s.mode === "optimal") {
    patch = { strategy: "optimal", thresholdWei: null, cronExpr: null, nextRunAt: null, minRewardWei: null };
    message = "บันทึกแล้ว: โหมด optimal (compound เมื่อ reward ≥ R*)";
  } else if (s.mode === "threshold") {
    patch = { strategy: "threshold", thresholdWei: s.thresholdKub, cronExpr: null, nextRunAt: null, minRewardWei: null };
    message = `บันทึกแล้ว: โหมด threshold (compound เมื่อ reward ≥ ${formatKub(s.thresholdKub as bigint, 18)} KUB)`;
  } else {
    const r = scheduleValuesToCron(values);
    if (!r.ok) return { ...fail(r.error, { [r.field]: r.error }), values };
    const tz = env.APP_TIMEZONE;
    const check = validateCron(r.expr, tz);
    if (!check.ok) {
      const field = values.scheduleKind === "custom" ? "cron" : "scheduleKind";
      return { ...fail(check.error, { [field]: check.error }), values };
    }
    const next = nextRunAt(r.expr, tz);
    if (!next) return { ...fail("cron นี้ไม่มีรอบถัดไป", { cron: "cron นี้ไม่มีรอบถัดไป" }), values };
    patch = { strategy: "schedule", cronExpr: r.expr, nextRunAt: next, thresholdWei: null, minRewardWei: s.minRewardKub };
    message = `บันทึกแล้ว: โหมด schedule (${r.expr})`;
  }

  try {
    const [row] = await getDb()
      .update(positions)
      .set({ ...patch, nextCheckAt: sql`now()`, updatedAt: new Date() })
      .where(eq(positions.id, positionId))
      .returning({ id: positions.id });
    if (!row) return { ...fail(NOT_FOUND), values };
  } catch (err) {
    logError("settings", err);
    return { ...fail(DB_ERROR), values };
  }
  revalidatePosition(positionId);
  return { ...ok(message), values };
}

/** Enables/disables auto-compound for the position (manual buttons keep working either way). */
export async function togglePosition(positionId: string, enabled: boolean): Promise<ActionResult> {
  await requireSession();
  if (!isUuid(positionId) || typeof enabled !== "boolean") return fail(NOT_FOUND);
  try {
    const [row] = await getDb()
      .update(positions)
      .set(enabled ? { enabled, nextCheckAt: sql`now()`, updatedAt: new Date() } : { enabled, updatedAt: new Date() })
      .where(eq(positions.id, positionId))
      .returning({ id: positions.id });
    if (!row) return fail(NOT_FOUND);
  } catch (err) {
    logError("toggle", err);
    return fail(DB_ERROR);
  }
  revalidatePosition(positionId);
  return ok(enabled ? "เปิด auto-compound แล้ว" : "ปิด auto-compound แล้ว (ปุ่มสั่งเองยังใช้ได้)");
}

/** Deletes the position — only when principal = 0, pending = 0 and no action is pending/running. */
export async function deletePosition(positionId: string): Promise<ActionResult> {
  await requireSession();
  if (!isUuid(positionId)) return fail(NOT_FOUND);
  try {
    const db = getDb();
    const pos = await getPositionWithRelations(db, positionId);
    if (!pos) return fail(NOT_FOUND);
    if (pos.principalWei !== 0n || pos.pendingWei !== 0n) {
      return fail("ลบได้เฉพาะเมื่อเงินต้นและ reward ค้างเป็น 0 — ถอนทั้งหมด (และ claim) ก่อน");
    }
    if ((await getOpenActionTypes(positionId)).size > 0) {
      return fail("มีคำสั่งที่ยังค้างอยู่ — รอ worker ทำให้เสร็จก่อนลบ");
    }
    const deleted = await db
      .delete(positions)
      .where(
        and(
          eq(positions.id, positionId),
          eq(positions.principalWei, 0n),
          eq(positions.pendingWei, 0n),
          sql`not exists (select 1 from ${actions} where ${actions.positionId} = ${positions.id} and ${inArray(actions.status, OPEN_ACTION_STATUSES)})`,
        ),
      )
      .returning({ id: positions.id });
    if (deleted.length === 0) return fail("ลบไม่สำเร็จ: สถานะ position เปลี่ยนระหว่างลบ — รีเฟรชแล้วลองใหม่");
  } catch (err) {
    logError("delete", err);
    return fail(DB_ERROR);
  }
  revalidatePath("/");
  redirect("/?deleted=1");
}
