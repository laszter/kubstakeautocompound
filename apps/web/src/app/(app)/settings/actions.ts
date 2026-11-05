"use server";

import { formatKub, gweiToWei, parseKub } from "@kubstake/core/browser";
import { updateSettings } from "@kubstake/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZodError } from "@/lib/action-result";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  SETTINGS_FIELDS,
  SETTINGS_LIMITS as L,
  settingsToFormValues,
  type SettingsFormState,
  type SettingsFormValues,
} from "./settings-fields";

const required = z.string().trim().min(1, "กรุณากรอกค่า");

/** KUB decimal → wei (bigint) with a lower bound. */
const kubField = (minWei: bigint) =>
  required
    .transform((v, ctx) => {
      try {
        return parseKub(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "ต้องเป็นจำนวน KUB เช่น 0.05" });
        return z.NEVER;
      }
    })
    .pipe(z.bigint().min(minWei, `ต้องไม่น้อยกว่า ${formatKub(minWei, 18)} KUB`));

const gweiField = (minWei: bigint, maxWei: bigint, msg: string) =>
  required
    .transform((v, ctx) => {
      try {
        return gweiToWei(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "ต้องเป็นตัวเลข gwei เช่น 50" });
        return z.NEVER;
      }
    })
    .pipe(z.bigint().min(minWei, msg).max(maxWei, msg));

const secondsField = (min: number) =>
  required
    .regex(/^\d+$/, "ต้องเป็นจำนวนเต็ม (วินาที)")
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(min, `ต้องไม่น้อยกว่า ${min.toLocaleString("en-US")} วินาที`)
        .max(L.maxSec, `ต้องไม่เกิน ${L.maxSec.toLocaleString("en-US")} วินาที (365 วัน)`),
    );

const gasMsg = `ต้องอยู่ระหว่าง ${L.maxGasPriceMinGwei}–${L.maxGasPriceMaxGwei} gwei`;

const settingsSchema = z
  .object({
    gasReserveKub: kubField(parseKub(L.gasReserveMinKub)),
    maxGasPriceGwei: gweiField(gweiToWei(L.maxGasPriceMinGwei), gweiToWei(L.maxGasPriceMaxGwei), gasMsg),
    minIntervalSec: secondsField(L.minIntervalMinSec),
    rFloorKub: kubField(0n),
    checkMinSec: secondsField(L.checkMinMinSec),
    checkMaxSec: secondsField(L.checkMinMinSec),
    validatorSyncSec: secondsField(L.validatorSyncMinSec),
  })
  .refine((s) => s.checkMaxSec >= s.checkMinSec, {
    message: "ต้องไม่น้อยกว่า check min",
    path: ["checkMaxSec"],
  });

function readValues(formData: FormData): SettingsFormValues {
  const out = {} as SettingsFormValues;
  for (const key of SETTINGS_FIELDS) {
    const v = formData.get(key);
    out[key] = typeof v === "string" ? v.slice(0, 100) : "";
  }
  return out;
}

/** Edits the single app_settings row (units: KUB / gwei / seconds). */
export async function updateAppSettings(
  _prev: SettingsFormState | null,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireSession();

  const values = readValues(formData);
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };

  const s = parsed.data;
  try {
    const row = await updateSettings(getDb(), {
      gasReserveWei: s.gasReserveKub,
      maxGasPriceWei: s.maxGasPriceGwei,
      minIntervalSec: s.minIntervalSec,
      rFloorWei: s.rFloorKub,
      checkMinSec: s.checkMinSec,
      checkMaxSec: s.checkMaxSec,
      validatorSyncSec: s.validatorSyncSec,
    });
    revalidatePath("/settings");
    return { ok: true, message: "บันทึกการตั้งค่าแล้ว — worker จะใช้ค่าใหม่ในรอบถัดไป", values: settingsToFormValues(row) };
  } catch (err) {
    console.error(`[settings] ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "บันทึกไม่สำเร็จ: ฐานข้อมูลไม่พร้อมหรือยังไม่มีแถว app_settings (รัน migrate ก่อน)", values };
  }
}
