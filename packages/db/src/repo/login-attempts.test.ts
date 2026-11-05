import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../client";
import {
  checkLoginRateLimit,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_SEC,
  recordLoginSuccess,
  reserveLoginAttempt,
} from "./login-attempts";

type Row = { success: boolean; attemptedAt: Date };

const IP = "203.0.113.7";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const failure = (m: number): Row => ({ success: false, attemptedAt: minutesAgo(m) });
const success = (m: number): Row => ({ success: true, attemptedAt: minutesAgo(m) });

/** Records the calls in order. Reads and writes only work on the handle `transaction` gives out when `txOnly` is set. */
function fakeDb(rows: Row[], { txOnly = false } = {}) {
  const calls: string[] = [];
  const statements: SQL[] = [];
  const handle = {
    execute: async (q: SQL) => {
      calls.push("lock");
      statements.push(q);
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              calls.push("count");
              return rows;
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: async (v: { success: boolean }) => {
        calls.push(`insert success=${v.success}`);
      },
    }),
    delete: () => ({
      where: async () => {
        calls.push("prune");
      },
    }),
  };
  const notInTransaction = () => {
    throw new Error("must go through tx");
  };
  const db = {
    ...(txOnly ? { execute: notInTransaction, select: notInTransaction, insert: notInTransaction } : handle),
    transaction: async <T>(fn: (tx: typeof handle) => Promise<T>) => {
      calls.push("begin");
      const result = await fn(handle);
      calls.push("commit");
      return result;
    },
  };
  return { db: db as unknown as DbExecutor, calls, statements };
}

describe("checkLoginRateLimit", () => {
  it("allows a clean IP with the full budget", async () => {
    const { db } = fakeDb([]);
    await expect(checkLoginRateLimit(db, IP)).resolves.toEqual({
      allowed: true,
      failures: 0,
      remaining: LOGIN_MAX_FAILURES,
      retryAfterSec: 0,
    });
  });

  it("allows the last try, then blocks until the oldest counted failure leaves the window", async () => {
    const four = [failure(10), failure(8), failure(6), failure(4)];
    const { db: lastTry } = fakeDb(four);
    await expect(checkLoginRateLimit(lastTry, IP)).resolves.toMatchObject({ allowed: true, failures: 4, remaining: 1 });

    const { db: blocked } = fakeDb([...four, failure(2)]);
    const limit = await checkLoginRateLimit(blocked, IP);
    expect(limit).toMatchObject({ allowed: false, failures: 5, remaining: 0 });
    const expected = LOGIN_WINDOW_SEC - 10 * 60;
    expect(limit.retryAfterSec).toBeGreaterThan(expected - 5);
    expect(limit.retryAfterSec).toBeLessThanOrEqual(expected);
  });

  it("does not count a successful attempt's own reservation, nor anything before the success", async () => {
    const { db } = fakeDb([failure(9), failure(8), failure(5), success(5 - 0.001)]);
    await expect(checkLoginRateLimit(db, IP)).resolves.toMatchObject({
      allowed: true,
      failures: 0,
      remaining: LOGIN_MAX_FAILURES,
    });
  });

  it("counts failures after the last success", async () => {
    const { db } = fakeDb([failure(9), success(8), failure(5), failure(3)]);
    await expect(checkLoginRateLimit(db, IP)).resolves.toMatchObject({ allowed: true, failures: 2, remaining: 3 });
  });
});

describe("reserveLoginAttempt", () => {
  it("locks, counts and stores the failure in one transaction, reading through tx", async () => {
    const { db, calls } = fakeDb([], { txOnly: true });
    await expect(reserveLoginAttempt(db, IP)).resolves.toMatchObject({ allowed: true, remaining: LOGIN_MAX_FAILURES });
    expect(calls).toEqual(["begin", "lock", "count", "insert success=false", "commit"]);
  });

  it("reports the budget from before this attempt, so the caller's `remaining - 1` is what is left after it", async () => {
    const { db } = fakeDb([failure(4)]);
    await expect(reserveLoginAttempt(db, IP)).resolves.toMatchObject({ failures: 1, remaining: 4 });
  });

  it("stores nothing when blocked", async () => {
    const { db, calls } = fakeDb([failure(9), failure(8), failure(7), failure(6), failure(5)]);
    await expect(reserveLoginAttempt(db, IP)).resolves.toMatchObject({ allowed: false });
    expect(calls).toEqual(["begin", "lock", "count", "commit"]);
  });

  it("takes the two-int4 lock on its own class, keyed by IP", async () => {
    const { db, statements } = fakeDb([]);
    await reserveLoginAttempt(db, IP);
    const query = new PgDialect().sqlToQuery(statements[0]!);
    expect(query.sql).toBe(`SELECT pg_advisory_xact_lock(${0x6b750002}, hashtext($1))`);
    expect(query.params).toEqual([IP]);
  });
});

describe("recordLoginSuccess", () => {
  it("stores a success and prunes, without another failure row", async () => {
    const { db, calls } = fakeDb([]);
    await recordLoginSuccess(db, IP);
    expect(calls).toEqual(["insert success=true", "prune"]);
  });
});
