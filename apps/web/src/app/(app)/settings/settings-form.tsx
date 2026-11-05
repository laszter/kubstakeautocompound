"use client";

import { useActionState } from "react";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAppSettings } from "./actions";
import { SETTINGS_LIMITS as L, type SettingsField, type SettingsFormState, type SettingsFormValues } from "./settings-fields";

const FIELDS: { name: SettingsField; label: string; unit: string; hint: string; inputMode: "decimal" | "numeric" }[] = [
  {
    name: "gasReserveKub",
    label: "Gas reserve",
    unit: "KUB",
    hint: `KUB ที่กันไว้ใน wallet เสมอสำหรับค่า gas — ไม่ถูก stake (ขั้นต่ำ ${L.gasReserveMinKub})`,
    inputMode: "decimal",
  },
  {
    name: "maxGasPriceGwei",
    label: "Max gas price",
    unit: "gwei",
    hint: `ถ้า gas price สูงกว่านี้ auto-compound จะข้ามรอบนั้น (ปุ่มสั่งเองไม่ติดเงื่อนไขนี้) — ${L.maxGasPriceMinGwei}–${L.maxGasPriceMaxGwei} gwei`,
    inputMode: "decimal",
  },
  {
    name: "minIntervalSec",
    label: "Min interval ระหว่าง compound",
    unit: "วินาที",
    hint: `ระยะห่างขั้นต่ำระหว่าง auto-compound ของ position เดียวกัน (≥ ${L.minIntervalMinSec.toLocaleString("en-US")})`,
    inputMode: "numeric",
  },
  {
    name: "rFloorKub",
    label: "R floor",
    unit: "KUB",
    hint: "reward ขั้นต่ำก่อน compound ในโหมด optimal (ใช้ค่าที่มากกว่าระหว่าง R* กับค่านี้)",
    inputMode: "decimal",
  },
  {
    name: "checkMinSec",
    label: "Check min",
    unit: "วินาที",
    hint: `ตรวจ position ถี่สุดทุก ๆ (≥ ${L.checkMinMinSec})`,
    inputMode: "numeric",
  },
  {
    name: "checkMaxSec",
    label: "Check max",
    unit: "วินาที",
    hint: "ตรวจ position ห่างสุดทุก ๆ (ต้อง ≥ check min)",
    inputMode: "numeric",
  },
  {
    name: "validatorSyncSec",
    label: "Validator sync",
    unit: "วินาที",
    hint: `ซิงก์รายชื่อ validator จาก chain ทุก ๆ (≥ ${L.validatorSyncMinSec})`,
    inputMode: "numeric",
  },
];

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const [state, formAction] = useActionState<SettingsFormState | null, FormData>(updateAppSettings, null);
  // React resets the form after the action; inputs then take these defaults (keeps what the user typed on error).
  const values = state?.values ?? initial;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const error = fieldErrors?.[f.name];
          return (
            <div key={f.name} className="flex flex-col gap-1.5">
              <Label htmlFor={f.name}>
                {f.label} <span className="text-muted-foreground font-normal">({f.unit})</span>
              </Label>
              <Input
                id={f.name}
                name={f.name}
                defaultValue={values[f.name]}
                inputMode={f.inputMode}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={`${f.name}-hint`}
              />
              <p id={`${f.name}-hint`} className={error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                {error ?? f.hint}
              </p>
            </div>
          );
        })}
      </div>
      <ActionMessage state={state} />
      <div>
        <SubmitButton pendingText="กำลังบันทึก...">บันทึกการตั้งค่า</SubmitButton>
      </div>
    </form>
  );
}
