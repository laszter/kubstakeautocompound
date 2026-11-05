"use client";

import { ADMIN_PASSWORD_MIN_LENGTH } from "@kubstake/core/browser";
import { useActionState } from "react";
import { ActionMessage } from "@/components/action-message";
import { PasswordField } from "@/components/password-field";
import { SubmitButton } from "@/components/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { changeAdminPassword } from "./password-actions";

export function PasswordForm() {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(changeAdminPassword, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-5" noValidate>
      <PasswordField
        name="current"
        label="รหัสผ่านปัจจุบัน"
        autoComplete="current-password"
        error={fieldErrors?.current}
      />
      <PasswordField
        name="password"
        label="รหัสผ่านใหม่"
        autoComplete="new-password"
        hint={`อย่างน้อย ${ADMIN_PASSWORD_MIN_LENGTH} ตัวอักษร ช่องว่างนับรวมด้วย`}
        error={fieldErrors?.password}
      />
      <PasswordField
        name="confirm"
        label="ยืนยันรหัสผ่านใหม่"
        autoComplete="new-password"
        error={fieldErrors?.confirm}
      />
      <ActionMessage state={state} />
      <div>
        <SubmitButton pendingText="กำลังเปลี่ยนรหัสผ่าน...">เปลี่ยนรหัสผ่าน</SubmitButton>
      </div>
    </form>
  );
}
