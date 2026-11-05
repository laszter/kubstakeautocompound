import type { ZodError } from "zod";

/**
 * Return type of every server action used with `useActionState` (initial state: `null`).
 * Never put secrets (private keys, ciphertext, passwords, password hashes) or bigint values in here — it is sent to the browser.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok(message?: string): ActionResult {
  return message === undefined ? { ok: true } : { ok: true, message };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** Form-level message when the details are in `fieldErrors`. */
export const INVALID_FIELDS_MESSAGE = "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบช่องที่มีข้อความสีแดง";

/** zod error → `{ ok:false }` with the first message per top-level field (messages must not echo secrets). */
export function fromZodError(err: ZodError, error = INVALID_FIELDS_MESSAGE): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    fieldErrors[key] ??= issue.message;
  }
  return fail(error, fieldErrors);
}
