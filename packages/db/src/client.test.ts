import { sql } from "drizzle-orm";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb, withDedicatedClient } from "./client";

// Never connects: the real pool runs real `pg.Client`s with their network methods stubbed, so pg-pool's listeners and
// drizzle's `isPool` check behave as in production.
const LOST = new Error("Connection terminated unexpectedly");

type Query = { text: string };

const pools: pg.Pool[] = [];

function setup({ failing = [] as string[], max = 1 } = {}) {
  const sent: string[] = [];
  vi.spyOn(pg.Client.prototype, "connect").mockImplementation(((done: () => void) => done()) as never);
  vi.spyOn(pg.Client.prototype, "end").mockImplementation(((done?: () => void) => done?.()) as never);
  vi.spyOn(pg.Client.prototype, "query").mockImplementation((async ({ text }: Query) => {
    sent.push(text);
    if (failing.includes(text)) throw LOST;
    return { rows: [], rowCount: 0 };
  }) as never);

  const onError = vi.fn();
  const { db, pool } = createDb("postgres://user:pass@127.0.0.1:1/db", { max, onError });
  pools.push(pool);

  const acquired = vi.fn();
  const released: (Error | undefined)[] = [];
  pool.on("acquire", acquired);
  pool.on("release", (err) => released.push(err));
  return { db, pool, sent, failing, onError, acquired, released };
}

afterEach(() => {
  // Not awaited: a pool that kept a client would never finish ending, and the failing test already says so.
  for (const pool of pools.splice(0)) void pool.end().catch(() => {});
  vi.restoreAllMocks();
});

describe("withDedicatedClient", () => {
  it("returns the client once and without an error when `fn` succeeds", async () => {
    const { pool, released, sent } = setup();
    const result = await withDedicatedClient(pool, (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        return "done";
      }),
    );
    expect(result).toBe("done");
    expect(sent).toEqual(["begin", "select 1", "commit"]);
    expect(released).toEqual([undefined]);
  });

  it("returns the client once with the error when `begin` fails", async () => {
    const { pool, released } = setup({ failing: ["begin"] });
    const run = vi.fn();
    await expect(withDedicatedClient(pool, (db) => db.transaction(run))).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(released).toHaveLength(1);
    expect(released[0]).toBeInstanceOf(Error);
  });

  it("returns the client once with the error `fn` threw, and passes that error on", async () => {
    const { pool, released } = setup();
    const boom = new Error("boom");
    await expect(
      withDedicatedClient(pool, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(released).toEqual([boom]);
  });

  it("returns the client with an Error when `fn` throws something else", async () => {
    const { pool, released } = setup();
    await expect(
      withDedicatedClient(pool, async () => {
        throw "boom";
      }),
    ).rejects.toBe("boom");
    expect(released).toHaveLength(1);
    expect(released[0]).toBeInstanceOf(Error);
  });

  it("is not treated as a pool by drizzle: one checkout, and drizzle itself releases nothing", async () => {
    const { pool, acquired, released } = setup();
    await withDedicatedClient(pool, (db) => db.transaction(async () => {}));
    expect(acquired).toHaveBeenCalledOnce();
    expect(released).toHaveLength(1);
  });

  it("checks out nothing and releases nothing when the pool can't connect", async () => {
    const { pool, released } = setup();
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("timeout") as never);
    const fn = vi.fn();
    await expect(withDedicatedClient(pool, fn)).rejects.toThrow("timeout");
    expect(fn).not.toHaveBeenCalled();
    expect(released).toEqual([]);
  });
});

describe("createDb", () => {
  it("commits `db.transaction` on one dedicated client", async () => {
    const { db, sent, acquired, released } = setup();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      return "done";
    });
    expect(result).toBe("done");
    expect(sent).toEqual(["begin", "select 1", "commit"]);
    expect(acquired).toHaveBeenCalledOnce();
    expect(released).toEqual([undefined]);
  });

  it("gives the only slot back when `begin` fails, unlike drizzle's own transaction on a pool", async () => {
    const { db, pool, failing, released } = setup({ failing: ["begin"], max: 1 });
    await expect(db.transaction(async () => {})).rejects.toThrow();
    expect(released).toHaveLength(1);
    expect(released[0]).toBeInstanceOf(Error);
    expect(pool.totalCount).toBe(0);

    failing.length = 0;
    await expect(db.transaction(async () => "again")).resolves.toBe("again");
  });

  it("rolls back when the callback throws, passes that error on, and destroys the connection", async () => {
    const { db, pool, sent, released } = setup();
    const boom = new Error("boom");
    await expect(
      db.transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(sent).toEqual(["begin", "rollback"]);
    expect(released).toEqual([boom]);
    expect(pool.totalCount).toBe(0);
  });

  it("passes the transaction config on to `begin`", async () => {
    const { db, sent } = setup();
    await db.transaction(async () => {}, { isolationLevel: "serializable" });
    expect(sent[0]).toBe("begin isolation level serializable");
  });

  it("runs a nested transaction as a savepoint on `tx`, without another checkout", async () => {
    // One slot only: a nested transaction that went back to the pool would wait for it forever.
    const { db, sent, acquired, released } = setup({ max: 1 });
    await db.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.execute(sql`select 1`);
      });
      await tx
        .transaction(async () => {
          throw new Error("inner");
        })
        .catch(() => {});
    });
    expect(sent).toEqual([
      "begin",
      "savepoint sp1",
      "select 1",
      "release savepoint sp1",
      "savepoint sp1",
      "rollback to savepoint sp1",
      "commit",
    ]);
    expect(acquired).toHaveBeenCalledOnce();
    expect(released).toEqual([undefined]);
  });

  it("keeps an 'error' listener on a client through checkout, release and the next checkout", async () => {
    const { pool } = setup();
    const client = await pool.connect();
    expect(client.listenerCount("error")).toBe(1);
    expect(() => client.emit("error", LOST)).not.toThrow();
    client.release();

    const again = await pool.connect();
    expect(again).toBe(client);
    expect(again.listenerCount("error")).toBe(1);
    expect(() => again.emit("error", LOST)).not.toThrow();
    again.release();
  });

  it("does not take an idle client's error away from `onError`", async () => {
    const { pool, onError } = setup();
    const client = await pool.connect();
    client.emit("error", LOST);
    expect(onError).not.toHaveBeenCalled();
    client.release();

    client.emit("error", LOST);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBe(LOST);
    expect(pool.totalCount).toBe(0);
  });
});
