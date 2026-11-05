"use client";

import { useActionState } from "react";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { login } from "./actions";

export function LoginForm() {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(login, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">รหัสผ่านผู้ดูแล</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          aria-invalid={state?.ok === false ? true : undefined}
        />
      </div>
      <ActionMessage state={state} />
      <SubmitButton className="w-full" pendingText="กำลังตรวจสอบ...">
        เข้าสู่ระบบ
      </SubmitButton>
    </form>
  );
}
