"use server";

import { formatKub, parseKub } from "@kubstake/core/browser";
import { enqueueAction, positions, validators, walletPublicColumns, wallets } from "@kubstake/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fail, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getWorkerStatus } from "@/lib/worker";
import { effectiveGasPrice, isValidatorDelegatable, maxDelegatableWei } from "../_lib/hints";
import { isUuid, type NewPositionState, type NewPositionValues } from "../_lib/position-fields";
import { getSettingsOrNull } from "../_lib/queries";

function readValues(formData: FormData): NewPositionValues {
  const get = (k: string, max: number) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  };
  return { walletId: get("walletId", 64), validatorId: get("validatorId", 12), amountKub: get("amountKub", 64) };
}

const withValues = (r: ActionResult, values: NewPositionValues): NewPositionState => ({ ...r, values });

/**
 * Creates a position (wallet × validator) and, if an initial amount is given, enqueues a `delegate` for it.
 * Unique (wallet, validator) conflict → redirect to the existing position. Web never signs or calls RPC.
 */
export async function createPosition(_prev: NewPositionState | null, formData: FormData): Promise<NewPositionState> {
  await requireSession();
  const values = readValues(formData);

  if (!isUuid(values.walletId)) return withValues(fail("กรุณาเลือก wallet", { walletId: "กรุณาเลือก wallet" }), values);
  if (!/^\d{1,9}$/.test(values.validatorId)) {
    return withValues(fail("กรุณาเลือก validator", { validatorId: "กรุณาเลือก validator" }), values);
  }
  const validatorId = Number(values.validatorId);

  let amountWei: bigint | null = null;
  if (values.amountKub !== "") {
    try {
      amountWei = parseKub(values.amountKub);
    } catch {
      const msg = "ต้องเป็นจำนวน KUB เช่น 100 หรือเว้นว่าง";
      return withValues(fail(msg, { amountKub: msg }), values);
    }
    if (amountWei === 0n) amountWei = null;
  }

  let target: string;
  try {
    const db = getDb();
    const [[wallet], [validator]] = await Promise.all([
      db.select(walletPublicColumns).from(wallets).where(eq(wallets.id, values.walletId)).limit(1),
      db.select().from(validators).where(eq(validators.validatorId, validatorId)).limit(1),
    ]);
    if (!wallet) return withValues(fail("ไม่พบ wallet นี้", { walletId: "ไม่พบ wallet นี้" }), values);
    if (!validator) return withValues(fail("ไม่พบ validator นี้", { validatorId: "ไม่พบ validator นี้" }), values);

    const findExisting = async () =>
      (
        await db
          .select({ id: positions.id })
          .from(positions)
          .where(and(eq(positions.walletId, wallet.id), eq(positions.validatorId, validatorId)))
          .limit(1)
      )[0];

    const existing = await findExisting();
    if (existing) {
      target = `/positions/${existing.id}?exists=1`;
    } else {
      if (!isValidatorDelegatable(validator)) {
        const msg = "validator นี้ปิดรับ delegate (delegation ปิด / paused / official pool / ไม่ active)";
        return withValues(fail(msg, { validatorId: msg }), values);
      }
      if (amountWei !== null) {
        if (amountWei < validator.minDelegatedWei) {
          const msg = `ครั้งแรกต้องไม่น้อยกว่า minDelegated ${formatKub(validator.minDelegatedWei, 18)} KUB`;
          return withValues(fail(msg, { amountKub: msg }), values);
        }
        const [settings, worker] = await Promise.all([getSettingsOrNull(), getWorkerStatus()]);
        if (!settings) return withValues(fail("ยังไม่มี app_settings — รัน migrate/worker ก่อน"), values);
        const gas = effectiveGasPrice(worker.heartbeat?.gasPriceWei);
        const max = maxDelegatableWei(wallet.balanceWei, settings.gasReserveWei, gas.wei);
        if (max === null) {
          const msg = "ยังไม่ทราบยอดคงเหลือของ wallet (รอ worker อ่านยอด) — เว้นว่างไว้ก่อนแล้ว delegate ทีหลังได้";
          return withValues(fail(msg, { amountKub: msg }), values);
        }
        if (amountWei > max) {
          const msg = `เกินยอดที่ใช้ได้ ${formatKub(max)} KUB (ยอดคงเหลือ − gas reserve ${formatKub(settings.gasReserveWei)} KUB − ค่า gas)`;
          return withValues(fail(msg, { amountKub: msg }), values);
        }
        if (!worker.fresh) {
          return withValues(
            fail("worker ไม่ตอบสนอง — ส่งคำสั่ง delegate ไม่ได้ตอนนี้ (เว้นจำนวนว่างเพื่อสร้าง position อย่างเดียว)"),
            values,
          );
        }
      }

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(positions)
          .values({ walletId: wallet.id, validatorId })
          .onConflictDoNothing({ target: [positions.walletId, positions.validatorId] })
          .returning({ id: positions.id });
        if (!row) return null;
        if (amountWei !== null) {
          await enqueueAction(tx, { type: "delegate", positionId: row.id, amountWei, requestedBy: "ui" });
        }
        return row;
      });
      if (created) {
        target = `/positions/${created.id}?created=1${amountWei !== null ? "&delegate=1" : ""}`;
      } else {
        // Lost a race with another create of the same pair.
        const again = await findExisting();
        if (!again) return withValues(fail("สร้าง position ไม่สำเร็จ — ลองใหม่อีกครั้ง"), values);
        target = `/positions/${again.id}?exists=1`;
      }
    }
  } catch (err) {
    console.error(`[positions:create] ${err instanceof Error ? err.message : String(err)}`);
    return withValues(fail("สร้าง position ไม่สำเร็จ: ฐานข้อมูลไม่พร้อม — ลองใหม่อีกครั้ง"), values);
  }

  revalidatePath("/");
  redirect(target);
}
