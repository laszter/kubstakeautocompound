"use server";

import { getAdminPasswordHash } from "@kubstake/db";
import { redirect } from "next/navigation";
import { fail, type ActionResult } from "@/lib/action-result";
import { attemptAdminPassword, startAdminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { safeErrorCode } from "@/lib/safe-error";
import { getSession } from "@/lib/session";

/**
 * useActionState action for the login form: no password set yet → /setup (not counted as an attempt);
 * otherwise rate limit → argon2 verify → session → redirect "/".
 */
export async function login(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) return fail("กรุณากรอกรหัสผ่าน");

  let destination = "/setup";
  try {
    const passwordHash = await getAdminPasswordHash(getDb());
    if (passwordHash !== null) {
      const attempt = await attemptAdminPassword(passwordHash, password);
      if (!attempt.ok) return attempt;
      await startAdminSession(passwordHash);
      destination = "/";
    }
  } catch (err) {
    // Never log the password, the hash or err.message (drizzle's includes query params) — only the failure code.
    console.error(`[login] failed (${safeErrorCode(err)})`);
    return fail("เข้าสู่ระบบไม่สำเร็จ: ระบบยังไม่พร้อม (ฐานข้อมูลหรือค่า env) — ดู log ของ web");
  }

  redirect(destination);
}

/**
 * Logout button in the app header. Always clears the cookie, valid or not, and never reads the DB: with `requireSession`
 * here a DB outage would redirect before `destroy`, and the session would come back with the DB.
 */
export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
