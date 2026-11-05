"use client";

import { useActionState } from "react";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addWallet } from "./actions";
import { PRIVATE_KEY_INPUT_MAX, WALLET_LABEL_MAX, type AddWalletState } from "./wallet-fields";

/**
 * Add-wallet form. The private key is an uncontrolled password input: it leaves the browser only inside the
 * form's FormData, is never kept in React state, and React clears it when the form resets after the action.
 */
export function WalletForm() {
  const [state, formAction] = useActionState<AddWalletState | null, FormData>(addWallet, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const label = state?.values?.label ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="off" noValidate>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wallet-label">ชื่อ (label)</Label>
          <Input
            id="wallet-label"
            name="label"
            defaultValue={label}
            maxLength={WALLET_LABEL_MAX}
            placeholder="เช่น Main stake"
            autoComplete="off"
            aria-invalid={fieldErrors?.label ? true : undefined}
            aria-describedby="wallet-label-hint"
          />
          <p id="wallet-label-hint" className={fieldErrors?.label ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
            {fieldErrors?.label ?? `ชื่อที่ใช้แสดงในระบบ (ไม่เกิน ${WALLET_LABEL_MAX} ตัวอักษร)`}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wallet-private-key">Private key</Label>
          <Input
            id="wallet-private-key"
            name="privateKey"
            type="password"
            className="font-mono"
            placeholder="0x… (hex 64 ตัว)"
            maxLength={PRIVATE_KEY_INPUT_MAX}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            aria-invalid={fieldErrors?.privateKey ? true : undefined}
            aria-describedby="wallet-private-key-hint"
          />
          <p
            id="wallet-private-key-hint"
            className={fieldErrors?.privateKey ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
          >
            {fieldErrors?.privateKey ??
              "ส่งไปที่ server ครั้งเดียวเพื่อเข้ารหัส — ระบบจะไม่ส่ง private key กลับมาที่ browser อีก (ต้องกรอกใหม่ทุกครั้งที่ส่งฟอร์ม)"}
          </p>
        </div>
      </div>
      <ActionMessage state={state} />
      <div>
        <SubmitButton pendingText="กำลังเข้ารหัสและบันทึก...">เพิ่ม wallet</SubmitButton>
      </div>
    </form>
  );
}
