// Rules for a new admin password. Pure, no `node:*` imports: this module is also exported through browser.ts.

export const ADMIN_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MAX_LENGTH = 1024;

/** One Thai message per invalid field. Messages never contain the submitted values. */
export type AdminPasswordErrors = { password?: string; confirm?: string };

/**
 * Validates a new admin password and its confirmation, as submitted (`unknown` because they come from FormData).
 * The values are compared as they are: no trim or normalization, so leading and trailing spaces count.
 * Length is `String.length`. Returns null when valid, otherwise an error for every invalid field.
 */
export function validateNewAdminPassword(password: unknown, confirm: unknown): AdminPasswordErrors | null {
  const errors: AdminPasswordErrors = {};
  if (typeof password !== "string" || password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    errors.password = `รหัสผ่านต้องมีอย่างน้อย ${ADMIN_PASSWORD_MIN_LENGTH} ตัวอักษร`;
  } else if (password.length > ADMIN_PASSWORD_MAX_LENGTH) {
    errors.password = `รหัสผ่านต้องไม่เกิน ${ADMIN_PASSWORD_MAX_LENGTH} ตัวอักษร`;
  }
  if (confirm !== password) {
    errors.confirm = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
  }
  return errors.password || errors.confirm ? errors : null;
}
