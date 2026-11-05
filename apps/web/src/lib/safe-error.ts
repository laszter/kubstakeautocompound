/** pg SQLSTATE (or error class name) only — never the message, which may contain query params. */
export function safeErrorCode(err: unknown): string {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code) return `code ${code}`;
    e = (e as { cause?: unknown }).cause;
  }
  return err instanceof Error ? err.name : typeof err;
}
