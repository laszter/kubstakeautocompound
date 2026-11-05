import "server-only";
import { createHash } from "node:crypto";
import { ADMIN_PASSWORD_MAX_LENGTH } from "@kubstake/core/browser";
import {
  getAdminPasswordHash,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_SEC,
  recordLoginSuccess,
  reserveLoginAttempt,
} from "@kubstake/db";
import { hash, verify } from "@node-rs/argon2";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fail, ok, type ActionResult } from "./action-result";
import { getDb } from "./db";
import { safeErrorCode } from "./safe-error";
import { getSession } from "./session";

/**
 * The hash is stored for good and a DB dump can be guessed at offline, so pin OWASP's minimum for argon2id rather
 * than rely on the library defaults. Argon2id itself is the library's default algorithm. Expected PHC prefix:
 * `$argon2id$v=19$m=19456,t=2,p=1$`.
 */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** Every page before and under login waits on the credential read, so a DB that stops answering can't hang them for longer. */
const CREDENTIAL_READ_TIMEOUT_MS = 5_000;

/**
 * Rejects when `work` hasn't settled after `ms`. `work` is not cancelled: on a frozen DB the query stays in flight, then
 * finishes and returns its connection to the pool by itself once the DB answers again.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException("timed out", "TimeoutError")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The stored hash, `null` when no password has been set, `undefined` when the DB can't be read in time (logged by code
 * only).
 */
async function readStoredHash(): Promise<string | null | undefined> {
  try {
    return await withTimeout(getAdminPasswordHash(getDb()), CREDENTIAL_READ_TIMEOUT_MS);
  } catch (err) {
    console.error(`[auth] reading admin credential failed (${safeErrorCode(err)})`);
    return undefined;
  }
}

/**
 * Whether an admin password exists. `unavailable` must never be treated as `unset`: a DB outage would otherwise open
 * the first-run form to anyone.
 */
export async function getAdminCredentialState(): Promise<"unset" | "set" | "unavailable"> {
  const passwordHash = await readStoredHash();
  if (passwordHash === undefined) return "unavailable";
  return passwordHash === null ? "unset" : "set";
}

/** Session claim binding a cookie to one stored hash. Every hash has a fresh salt, so any change invalidates old cookies. */
function credentialTagOf(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url");
}

/** The one session check: `requireSession` and `hasSession` must agree, or /login and / would redirect to each other. */
async function isSessionValid(): Promise<boolean> {
  const session = await getSession();
  if (typeof session.loggedInAt !== "number" || typeof session.credentialTag !== "string") return false;
  const passwordHash = await readStoredHash();
  return typeof passwordHash === "string" && credentialTagOf(passwordHash) === session.credentialTag;
}

/**
 * Gate for every page / server action / route handler under (app). Redirects to /login (by throwing
 * Next's redirect error) when there is no valid session. Do not wrap calls to it in try/catch.
 */
export async function requireSession(): Promise<void> {
  if (!(await isSessionValid())) redirect("/login");
}

/** true if the request carries a valid session (for pages that must not redirect, e.g. /login). */
export async function hasSession(): Promise<boolean> {
  return isSessionValid();
}

/** Logs this browser in for `passwordHash`. `session.save()` only works in server actions / route handlers. */
export async function startAdminSession(passwordHash: string): Promise<void> {
  const session = await getSession();
  session.loggedInAt = Date.now();
  session.credentialTag = credentialTagOf(passwordHash);
  await session.save();
}

/** argon2id hash (PHC string) of a new admin password; never logs the input. */
export function hashAdminPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Compares `input` with the stored hash via argon2 verify (constant-time); never logs the input. */
async function verifyAdminPassword(passwordHash: string, input: string): Promise<boolean> {
  if (input.length === 0 || input.length > ADMIN_PASSWORD_MAX_LENGTH) return false;
  return verify(passwordHash, input);
}

function rateLimitedMessage(retryAfterSec: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `ใส่รหัสผ่านผิดเกิน ${LOGIN_MAX_FAILURES} ครั้งใน ${LOGIN_WINDOW_SEC / 60} นาที — กรุณารออีกประมาณ ${minutes} นาทีแล้วลองใหม่`;
}

/**
 * Reserve a try under the rate limit → argon2 verify → record a success. The only way to check a password, so /login
 * and the change-password form share one limit, and parallel requests can't pass it together. Throws when the DB fails:
 * callers log `safeErrorCode` only. The reservation then stays counted as a failure.
 */
export async function attemptAdminPassword(passwordHash: string, input: string): Promise<ActionResult> {
  const ip = await getClientIp();
  const limit = await reserveLoginAttempt(getDb(), ip);
  if (!limit.allowed) return fail(rateLimitedMessage(limit.retryAfterSec));

  // After the reservation has committed: argon2 must not hold a connection or the IP's lock while it hashes.
  const valid = await verifyAdminPassword(passwordHash, input);
  if (valid) {
    await recordLoginSuccess(getDb(), ip);
    return ok();
  }
  const left = limit.remaining - 1;
  return fail(left > 0 ? `รหัสผ่านไม่ถูกต้อง (ลองได้อีก ${left} ครั้ง)` : rateLimitedMessage(LOGIN_WINDOW_SEC));
}

/** Client IP for rate limiting: first `x-forwarded-for` entry, else 127.0.0.1. */
async function getClientIp(): Promise<string> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "127.0.0.1";
}
