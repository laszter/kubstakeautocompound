"use client";

import { ADMIN_PASSWORD_MIN_LENGTH } from "@kubstake/core/browser";
import { useActionState } from "react";
import { ActionMessage } from "@/components/action-message";
import { PasswordField } from "@/components/password-field";
import { SubmitButton } from "@/components/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { setupAdmin } from "./actions";

export function SetupForm() {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(setupAdmin, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <PasswordField
        name="password"
        label="รหัสผ่าน"
        autoComplete="new-password"
        hint={`อย่างน้อย ${ADMIN_PASSWORD_MIN_LENGTH} ตัวอักษร ช่องว่างนับรวมด้วย`}
        error={fieldErrors?.password}
        autoFocus
      />
      <PasswordField
        name="confirm"
        label="ยืนยันรหัสผ่าน"
        autoComplete="new-password"
        error={fieldErrors?.confirm}
      />
      <ActionMessage state={state} />
      <SubmitButton className="w-full" pendingText="กำลังตั้งรหัสผ่าน...">
        ตั้งรหัสผ่านและเข้าสู่ระบบ
      </SubmitButton>
    </form>
  );
}
