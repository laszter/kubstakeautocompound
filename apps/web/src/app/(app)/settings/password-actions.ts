"use server";

import { validateNewAdminPassword } from "@kubstake/core/browser";
import { getAdminPasswordHash, replaceAdminPasswordHash } from "@kubstake/db";
import { redirect } from "next/navigation";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { attemptAdminPassword, hashAdminPassword, requireSession, startAdminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { safeErrorCode } from "@/lib/safe-error";

const ALREADY_CHANGED = "รหัสผ่านถูกเปลี่ยนไปแล้ว กรุณาลองใหม่";

/**
 * useActionState action of the change-password form: session → rate limit + verify current (recorded like a login) →
 * validate new → compare-and-swap the hash → re-tag this session. Every other session's tag stops matching, so they
 * are logged out. Passwords are read as submitted and are never returned or logged.
 */
export async function changeAdminPassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const current = formData.get("current");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof current !== "string" || current.length === 0) {
    return fail(INVALID_FIELDS_MESSAGE, {
      current: "กรุณากรอกรหัสผ่านปัจจุบัน",
      ...validateNewAdminPassword(password, confirm),
    });
  }

  let replaced = false;
  try {
    const db = getDb();
    const currentHash = await getAdminPasswordHash(db);
    if (currentHash === null) return fail(ALREADY_CHANGED);

    const attempt = await attemptAdminPassword(currentHash, current);
    if (!attempt.ok) return fail(INVALID_FIELDS_MESSAGE, { current: attempt.error });

    const errors = validateNewAdminPassword(password, confirm);
    if (errors || typeof password !== "string") return fail(INVALID_FIELDS_MESSAGE, { ...errors });

    const newHash = await hashAdminPassword(password);
    replaced = await replaceAdminPasswordHash(db, currentHash, newHash);
    if (!replaced) return fail(ALREADY_CHANGED);

    await startAdminSession(newHash);
    return ok("เปลี่ยนรหัสผ่านแล้ว");
  } catch (err) {
    console.error(`[settings] change password failed (${safeErrorCode(err)})`);
    if (!replaced) return fail("เปลี่ยนรหัสผ่านไม่สำเร็จ: ระบบยังไม่พร้อม — ดู log ของ web");
  }

  // The new password is stored and only this session's update failed: its old tag no longer matches, so log in again.
  redirect("/login");
}
