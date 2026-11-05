import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { loginAttempts } from "../schema";

/** Login rate limit: at most this many failed attempts per IP ... */
export const LOGIN_MAX_FAILURES = 5;
/** ... within this sliding window. */
export const LOGIN_WINDOW_SEC = 15 * 60;

/**
 * First key of the two-int4 advisory lock used to serialize attempts per IP. Must differ from `ENQUEUE_LOCK_CLASS` in
 * actions.ts. The two-key space never overlaps the single-bigint key space used by the worker leader/migrate locks.
 */
const LOGIN_ATTEMPT_LOCK_CLASS = 0x6b750002;

export type LoginRateLimit = {
  allowed: boolean;
  /** failed attempts counted in the current window (after the last successful login) */
  failures: number;
  /** failed attempts left before the IP gets blocked */
  remaining: number;
  /** seconds until the next attempt is allowed (0 when allowed) */
  retryAfterSec: number;
};

/** 5 failed logins / 15 min / IP (sliding window; a successful login resets the count). */
export async function checkLoginRateLimit(db: DbExecutor, ip: string): Promise<LoginRateLimit> {
  const now = Date.now();
  const windowStart = new Date(now - LOGIN_WINDOW_SEC * 1000);
  const rows = await db
    .select({ success: loginAttempts.success, attemptedAt: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gte(loginAttempts.attemptedAt, windowStart)))
    .orderBy(asc(loginAttempts.attemptedAt))
    .limit(200);

  const lastSuccess = rows.findLastIndex((r) => r.success);
  const failures = rows.slice(lastSuccess + 1).filter((r) => !r.success);
  const n = failures.length;
  if (n < LOGIN_MAX_FAILURES) {
    return { allowed: true, failures: n, remaining: LOGIN_MAX_FAILURES - n, retryAfterSec: 0 };
  }
  // Allowed again once enough failures slide out of the window to drop below the limit.
  const freesAt = failures[n - LOGIN_MAX_FAILURES]!.attemptedAt.getTime() + LOGIN_WINDOW_SEC * 1000;
  return {
    allowed: false,
    failures: n,
    remaining: 0,
    retryAfterSec: Math.max(1, Math.ceil((freesAt - now) / 1000)),
  };
}

/**
 * Claims one password check for `ip` before it runs, so parallel requests can't all pass the limit on the same count.
 * When allowed, a failure row is already stored: a wrong password needs no further write, and a right one is settled by
 * `recordLoginSuccess`. The returned counts are from before this attempt. Run the (slow) password check after this
 * returns, never inside it: the lock and the connection are held until commit.
 */
export async function reserveLoginAttempt(db: DbExecutor, ip: string): Promise<LoginRateLimit> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(String(LOGIN_ATTEMPT_LOCK_CLASS))}, hashtext(${ip}))`);
    const limit = await checkLoginRateLimit(tx, ip);
    if (limit.allowed) await tx.insert(loginAttempts).values({ ip, success: false });
    return limit;
  });
}

/**
 * Records a correct password; also prunes attempts older than 1 day (keeps the table tiny). `attempted_at` defaults to
 * the statement's start, later than the commit of this attempt's reservation, so the reserved failure stops counting.
 */
export async function recordLoginSuccess(db: DbExecutor, ip: string): Promise<void> {
  await db.insert(loginAttempts).values({ ip, success: true });
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(Date.now() - 86_400_000)));
}
