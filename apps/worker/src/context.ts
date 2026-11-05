import type { Db, SettingsRow } from "@kubstake/db";
import type { ChainIo } from "./chainIo";
import type { AccountLoader } from "./keys";
import type { Logger } from "./logger";
import type { EngineStore } from "./engine";
import type { TxManager } from "./txManager";

export type WorkerConfig = {
  /** '' = subgraph disabled */
  subgraphUrl: string;
  /** APP_TIMEZONE (cron evaluation) */
  timezone: string;
  tickIntervalSec: number;
};

/** Mutable per-process bookkeeping (not persisted). */
export type WorkerState = {
  lastValidatorSyncAttemptAt: number | null;
  lastPruneDay: string | null;
};

/** Settings + per-tick chain facts passed to the steps of one tick. */
export type TickInputs = {
  settings: SettingsRow;
  /** gas price read once per tick (heartbeat); undefined → steps read it themselves */
  gasPriceWei?: bigint;
};

export type WorkerCtx = {
  db: Db;
  chain: ChainIo;
  txManager: TxManager;
  store: EngineStore;
  accounts: AccountLoader;
  log: Logger;
  config: WorkerConfig;
  instanceId: string;
  startedAt: Date;
  version: string;
  state: WorkerState;
  now: () => Date;
  /** true after SIGTERM/SIGINT or when the leader lock is lost: finish the current step, then stop */
  shouldStop: () => boolean;
};
