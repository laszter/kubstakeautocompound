import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import {
  CHAIN_ID,
  assertChainId,
  createKubPublicClient,
  createLimiter,
  loadWorkerEnv,
  parseMasterKey,
  type WorkerEnv,
} from "@kubstake/core";
import { createDb, ensureSettings } from "@kubstake/db";
import { createViemChainIo } from "./chainIo";
import type { WorkerCtx } from "./context";
import { errMsg, sleep } from "./errors";
import { createTxSettledHandler } from "./executor";
import { createAccountLoader } from "./keys";
import { acquireLeaderLock, type LeaderLock } from "./lock";
import { createLogger, type Logger } from "./logger";
import { startLoop } from "./scheduler";
import { createDbEngineStore, createDbTxStore } from "./store";
import { TxManager } from "./txManager";
import { WORKER_VERSION } from "./version";

// Entry: env → logger → db pool → chainId 96 (retry) → app_settings (retry DB) → leader lock → recover
// in-flight txs → tick loop (each tick also recovers txs and stale actions).
// SIGTERM/SIGINT: finish the current step, release the lock, close the pool, exit 0.

async function retryUntil<T>(
  what: string,
  fn: () => Promise<T>,
  opts: { log: Logger; signal: AbortSignal; delaysMs: readonly number[] },
): Promise<T | undefined> {
  for (let attempt = 0; !opts.signal.aborted; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = opts.delaysMs[Math.min(attempt, opts.delaysMs.length - 1)] ?? 10_000;
      opts.log.warn({ err: errMsg(err), attempt: attempt + 1, retryInSec: delay / 1000 }, `${what} not ready; retrying`);
      await sleep(delay, opts.signal);
    }
  }
  return undefined;
}

function rpcHost(url: string): string {
  try {
    return new URL(url).host; // never log paths/query strings (may embed API keys)
  } catch {
    return "(invalid)";
  }
}

async function main(): Promise<number> {
  let env: WorkerEnv;
  try {
    env = loadWorkerEnv();
  } catch (err) {
    // loadWorkerEnv lists variable names + reasons only (never values) — log all of it
    createLogger("info").fatal({ err: err instanceof Error ? err.message : String(err) }, "invalid worker environment; refusing to start");
    return 1;
  }
  const log = createLogger(env.LOG_LEVEL);
  const masterKey = parseMasterKey(env.MASTER_KEY); // validated by loadWorkerEnv (32 bytes)

  const ac = new AbortController();
  let signals = 0;
  const onSignal = (sig: NodeJS.Signals) => {
    signals++;
    if (signals > 1) {
      log.warn({ signal: sig }, "second signal: exiting immediately");
      process.exit(1);
    }
    log.info({ signal: sig }, "shutdown requested; finishing the current step");
    ac.abort();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("unhandledRejection", (reason) => {
    log.fatal({ err: errMsg(reason) }, "unhandled promise rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    log.fatal({ err: errMsg(err) }, "uncaught exception");
    process.exit(1);
  });

  const instanceId = `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
  log.info(
    {
      version: WORKER_VERSION,
      instanceId,
      dryRun: env.DRY_RUN,
      rpc: rpcHost(env.RPC_URL),
      tickIntervalSec: env.TICK_INTERVAL_SEC,
      rpcConcurrency: env.RPC_CONCURRENCY,
      subgraph: env.SUBGRAPH_URL ? rpcHost(env.SUBGRAPH_URL) : "disabled",
      timezone: env.APP_TIMEZONE,
    },
    "worker starting",
  );
  if (env.DRY_RUN) log.info("DRY_RUN=true: transactions are simulated only (nothing is signed or broadcast)");
  // host[:port] only (rpcHost drops userinfo/path/query) — on the default RPC this is KUB mainnet, on a fork it is the fork
  else log.warn(`DRY_RUN=false: the worker WILL sign and broadcast real transactions to ${rpcHost(env.RPC_URL)} (chainId ${CHAIN_ID})`);

  const { db, pool } = createDb(env.DATABASE_URL, {
    max: 5,
    onError: (err) => log.warn({ err: errMsg(err) }, "idle database client error"),
  });
  const client = createKubPublicClient(env.RPC_URL);
  const chain = createViemChainIo(client, {
    limit: createLimiter(env.RPC_CONCURRENCY),
    discoveryConcurrency: env.RPC_CONCURRENCY,
    subgraphUrl: env.SUBGRAPH_URL,
    log: (m) => log.debug({ src: "discovery" }, m),
  });

  let lock: LeaderLock | null = null;
  try {
    const chainOk = await retryUntil("RPC chainId check", () => assertChainId(client).then(() => true), {
      log,
      signal: ac.signal,
      delaysMs: [10_000],
    });
    if (ac.signal.aborted || !chainOk) return 0;
    log.info({ chainId: CHAIN_ID, rpc: rpcHost(env.RPC_URL) }, "chainId 96 OK");

    const settings = await retryUntil("database", () => ensureSettings(db, env.settingsSeed), {
      log,
      signal: ac.signal,
      delaysMs: [2000, 4000, 8000, 15_000, 30_000],
    });
    if (ac.signal.aborted || !settings) return 0;
    log.info("database OK (app_settings ready)");

    const store = createDbEngineStore(db);
    const txManager = new TxManager({
      chain,
      store: createDbTxStore(db),
      dryRun: env.DRY_RUN,
      log,
      onSettled: createTxSettledHandler(db, log),
    });
    const ctx: WorkerCtx = {
      db,
      chain,
      txManager,
      store,
      accounts: createAccountLoader(db, masterKey),
      log,
      config: {
        dryRun: env.DRY_RUN,
        subgraphUrl: env.SUBGRAPH_URL,
        timezone: env.APP_TIMEZONE,
        tickIntervalSec: env.TICK_INTERVAL_SEC,
      },
      instanceId,
      startedAt: new Date(),
      version: WORKER_VERSION,
      state: { lastValidatorSyncAttemptAt: null, lastPruneDay: null },
      now: () => new Date(),
      shouldStop: () => ac.signal.aborted || (lock?.lost ?? false),
    };

    while (!ac.signal.aborted) {
      lock = await acquireLeaderLock(pool, { log, signal: ac.signal });
      if (!lock) break;
      log.info({ instanceId }, "leader lock acquired");
      const held = lock;
      try {
        await txManager
          .recoverInFlight()
          .catch((err: unknown) => log.error({ err: errMsg(err) }, "startup tx recovery failed"));
        await startLoop(ctx, {
          signal: ac.signal,
          shouldContinue: () => !held.lost,
          beforeTick: () => held.check(),
        });
      } finally {
        await held.release();
      }
      if (!ac.signal.aborted) {
        log.error("leader lock lost; re-acquiring");
        lock = null;
        await sleep(5000, ac.signal);
      }
    }
    return 0;
  } finally {
    await pool.end().catch(() => {});
    log.info("worker stopped");
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    createLogger("info").fatal({ err: errMsg(err, 2000) }, "worker crashed");
    process.exit(1);
  },
);
