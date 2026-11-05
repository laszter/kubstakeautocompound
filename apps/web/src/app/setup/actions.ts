"use server";

import { validateNewAdminPassword } from "@kubstake/core/browser";
import { createAdminCredential, getAdminPasswordHash } from "@kubstake/db";
import { redirect } from "next/navigation";
import { fail, INVALID_FIELDS_MESSAGE, type ActionResult } from "@/lib/action-result";
import { hashAdminPassword, startAdminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { safeErrorCode } from "@/lib/safe-error";

/**
 * useActionState action of the first-run form. Needs no session and can be called directly, so it protects itself:
 * validate → already set? /login before spending argon2 → hash → insert (never overwrites; one winner among concurrent
 * callers) → lost the race? /login → won: session, then "/".
 */
export async function setupAdmin(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  // Read as submitted: spaces count, and the value is never returned or logged.
  const password = formData.get("password");
  const errors = validateNewAdminPassword(password, formData.get("confirm"));
  if (errors || typeof password !== "string") return fail(INVALID_FIELDS_MESSAGE, { ...errors });

  let destination = "/login";
  let created = false;
  try {
    const db = getDb();
    if ((await getAdminPasswordHash(db)) === null) {
      const passwordHash = await hashAdminPassword(password);
      created = await createAdminCredential(db, passwordHash);
      if (created) {
        await startAdminSession(passwordHash);
        destination = "/";
      }
    }
  } catch (err) {
    console.error(`[setup] failed (${safeErrorCode(err)})`);
    // Once stored, only the session failed: the new password works at /login, so don't report it as not set.
    if (!created) return fail("ตั้งรหัสผ่านไม่สำเร็จ: ระบบยังไม่พร้อม — ดู log ของ web");
  }

  redirect(destination);
}
