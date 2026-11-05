import type pg from "pg";
import { errMsg, sleep } from "./errors";
import type { Logger } from "./logger";

// Single active worker: a session-level advisory lock held on a dedicated connection for the process
// lifetime. A standby instance does not exit (compose would restart-loop it) — it retries every 30s.

export const LEADER_LOCK_NAME = "kubstake-worker";

export type LeaderLock = {
  /** true once the lock connection errored / closed (the lock is gone with it). */
  readonly lost: boolean;
  /** Round-trip on the lock connection; false (and `lost`) if the session is gone. */
  check(): Promise<boolean>;
  release(): Promise<void>;
};

export async function acquireLeaderLock(
  pool: pg.Pool,
  opts: { log: Logger; signal?: AbortSignal; retryMs?: number },
): Promise<LeaderLock | null> {
  const retryMs = opts.retryMs ?? 30_000;
  while (!opts.signal?.aborted) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
        LEADER_LOCK_NAME,
      ]);
      if (res.rows[0]?.locked === true) return holdLock(client, opts.log);
      client.release();
      client = null;
      opts.log.warn({ retrySec: retryMs / 1000 }, "another worker holds the leader lock; standing by");
    } catch (err) {
      client?.release(err instanceof Error ? err : true);
      opts.log.warn({ err: errMsg(err), retrySec: retryMs / 1000 }, "leader lock: database not reachable; retrying");
    }
    await sleep(retryMs, opts.signal);
  }
  return null;
}

function holdLock(client: pg.PoolClient, log: Logger): LeaderLock {
  let lost = false;
  let released = false;
  const onError = (err: Error) => {
    if (released) return;
    lost = true;
    log.error({ err: errMsg(err) }, "leader lock connection failed; lock lost");
  };
  client.on("error", onError);
  return {
    get lost() {
      return lost;
    },
    async check() {
      if (lost) return false;
      try {
        await client.query("SELECT 1");
        return true;
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        return false;
      }
    },
    async release() {
      if (released) return;
      released = true;
      try {
        if (!lost) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LEADER_LOCK_NAME]);
      } catch {
        // the session is going away anyway; closing it releases the lock
      } finally {
        client.removeListener("error", onError);
        client.release(true); // destroy the connection: guarantees the session lock is gone
      }
    },
  };
}
