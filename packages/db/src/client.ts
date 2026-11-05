import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Anything repo helpers can run against: the `Db` itself or a transaction handed out by
 * `db.transaction(async (tx) => ...)` (both extend `PgDatabase`).
 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type CreateDbOptions = {
  /** pool size (pg default 10) */
  max?: number;
  /**
   * Called when an *idle* pooled client errors (e.g. Postgres restarted). Without a listener node-postgres
   * re-emits it as an uncaught 'error' event and crashes the process. Default: one line on stderr.
   */
  onError?: (err: Error) => void;
  /** Give up on a new connection or a pool checkout after this long. Default: wait forever. */
  connectionTimeoutMillis?: number;
};

const ignoreError = () => {};

/**
 * Runs `fn` on one client checked out from `pool`, the way `createDb` runs `db.transaction`: drizzle's transaction on a
 * pool runs `begin` outside its try, so a failed `begin` never releases the client and the pool slot is lost until
 * restart. A failure in `fn` destroys the connection instead of returning it to the pool.
 */
export async function withDedicatedClient<T>(pool: pg.Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    return await fn(drizzle(client, { schema }));
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    client.release(failure);
  }
}

export function createDb(databaseUrl: string, opts?: CreateDbOptions): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: opts?.max ?? 10,
    connectionTimeoutMillis: opts?.connectionTimeoutMillis,
  });
  pool.on("error", opts?.onError ?? ((err) => console.error(`[db] idle client error: ${err.message}`)));
  // The pool's own listener is off during a checkout, and an 'error' event with no listener is an uncaught exception.
  // Nothing is hidden: the query in flight and any later one reject with the error.
  pool.on("connect", (client) => client.on("error", ignoreError));
  const db = drizzle(pool, { schema });
  // A nested transaction runs on `tx`, so it stays a savepoint and never comes through here.
  db.transaction = (fn, config) => withDedicatedClient(pool, (own) => own.transaction(fn, config));
  return { db, pool };
}
