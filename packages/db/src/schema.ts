import { relations, sql, type SQL } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { wei } from "./columns";

// ---------------------------------------------------------------------------
// Allowed values for text columns guarded by CHECK constraints (no pg enums → simpler migrations)
// ---------------------------------------------------------------------------
export const POSITION_STRATEGIES = ["optimal", "threshold", "schedule"] as const;
export type PositionStrategy = (typeof POSITION_STRATEGIES)[number];

export const ACTION_TYPES = ["delegate", "undelegate", "claim", "compound", "sync_validators"] as const;
export const ACTION_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
export const ACTION_REQUESTERS = ["ui", "engine"] as const;
export type ActionRequester = (typeof ACTION_REQUESTERS)[number];

export const TX_ROW_KINDS = ["delegate", "undelegate", "claim", "compound_delegate", "compound_claim"] as const;
export type TxRowKind = (typeof TX_ROW_KINDS)[number];
export const TX_STATUSES = ["signed", "broadcast", "confirmed", "reverted", "failed"] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

/** `"col" IN ('a', 'b')` for a CHECK constraint. Values are compile-time constants (never user input). */
function inList(col: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return sql`${col} IN (${sql.raw(list)})`;
}

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// wallets
// ---------------------------------------------------------------------------
export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  /** checksummed (viem `privateKeyToAccount(pk).address`) */
  address: text("address").notNull().unique(),
  /** `v1:<iv b64>:<tag b64>:<ct b64>` — AES-256-GCM, AAD = lowercase address. Never send to the browser. */
  encryptedKey: text("encrypted_key").notNull(),
  balanceWei: wei("balance_wei"),
  balanceUpdatedAt: tstz("balance_updated_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Every wallet column except `encryptedKey` — use for anything that may reach the web UI. */
export const walletPublicColumns = {
  id: wallets.id,
  label: wallets.label,
  address: wallets.address,
  balanceWei: wallets.balanceWei,
  balanceUpdatedAt: wallets.balanceUpdatedAt,
  createdAt: wallets.createdAt,
  updatedAt: wallets.updatedAt,
} as const;

// ---------------------------------------------------------------------------
// validators (synced by the worker from StakeManagerStorage + ValidatorShare)
// ---------------------------------------------------------------------------
export const validators = pgTable("validators", {
  validatorId: integer("validator_id").primaryKey(),
  /** lowercase */
  shareAddress: text("share_address").notNull().unique(),
  signer: text("signer").notNull(),
  name: text("name"),
  imageUrl: text("image_url"),
  /** 0 Uninit / 1 Active / 2 Unstaked */
  status: smallint("status").notNull(),
  commissionBps: integer("commission_bps").notNull(),
  infraCommissionBps: integer("infra_commission_bps").notNull(),
  selfStakeWei: wei("self_stake_wei").notNull(),
  delegatedWei: wei("delegated_wei").notNull(),
  totalSupplyWei: wei("total_supply_wei").notNull(),
  minDelegatedWei: wei("min_delegated_wei").notNull(),
  delegationEnabled: boolean("delegation_enabled").notNull(),
  paused: boolean("paused").notNull(),
  isOfficialPool: boolean("is_official_pool").notNull(),
  inMinimalSet: boolean("in_minimal_set").notNull(),
  syncedAt: tstz("synced_at").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// positions (wallet × validator, each with its own auto-compound settings)
// ---------------------------------------------------------------------------
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    validatorId: integer("validator_id")
      .notNull()
      .references(() => validators.validatorId),
    enabled: boolean("enabled").notNull().default(true),
    strategy: text("strategy", { enum: POSITION_STRATEGIES }).notNull().default("optimal"),
    thresholdWei: wei("threshold_wei"),
    cronExpr: text("cron_expr"),
    minRewardWei: wei("min_reward_wei"),
    nextRunAt: tstz("next_run_at"),
    principalWei: wei("principal_wei").notNull().default(sql`0`),
    pendingWei: wei("pending_wei").notNull().default(sql`0`),
    /** wallet's free balance at the time of the last check */
    liquidWei: wei("liquid_wei"),
    chainSyncedAt: tstz("chain_synced_at"),
    aprEst: doublePrecision("apr_est"),
    rStarWei: wei("r_star_wei"),
    etaSec: integer("eta_sec"),
    nextCheckAt: tstz("next_check_at").notNull().defaultNow(),
    lastCheckAt: tstz("last_check_at"),
    lastCompoundAt: tstz("last_compound_at"),
    lastRunAt: tstz("last_run_at"),
    lastRunResult: text("last_run_result"),
    claimOnly: boolean("claim_only").notNull().default(false),
    backoffLevel: integer("backoff_level").notNull().default(0),
    lastFailureAt: tstz("last_failure_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("positions_wallet_validator_unique").on(t.walletId, t.validatorId),
    check("positions_strategy_check", inList(t.strategy, POSITION_STRATEGIES)),
  ],
);

// ---------------------------------------------------------------------------
// actions (queue: web enqueues, worker executes)
// ---------------------------------------------------------------------------
export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "cascade" }),
    type: text("type", { enum: ACTION_TYPES }).notNull(),
    status: text("status", { enum: ACTION_STATUSES }).notNull().default("pending"),
    amountWei: wei("amount_wei"),
    requestedBy: text("requested_by", { enum: ACTION_REQUESTERS }).notNull().default("ui"),
    /** last tx produced by this action (no FK: txs.action_id already points back here) */
    txId: uuid("tx_id"),
    error: text("error"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("actions_status_created_at_idx").on(t.status, t.createdAt),
    check("actions_type_check", inList(t.type, ACTION_TYPES)),
    check("actions_status_check", inList(t.status, ACTION_STATUSES)),
    check("actions_requested_by_check", inList(t.requestedBy, ACTION_REQUESTERS)),
  ],
);

// ---------------------------------------------------------------------------
// txs (tx state machine; row is inserted with hash + signed raw BEFORE broadcast)
// ---------------------------------------------------------------------------
export const txs = pgTable(
  "txs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "set null" }),
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    kind: text("kind", { enum: TX_ROW_KINDS }).notNull(),
    status: text("status", { enum: TX_STATUSES }).notNull(),
    hash: text("hash").notNull().unique(),
    signedRaw: text("signed_raw").notNull(),
    nonce: integer("nonce").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    valueWei: wei("value_wei").notNull(),
    gasLimit: bigint("gas_limit", { mode: "bigint" }).notNull(),
    gasPriceWei: wei("gas_price_wei").notNull(),
    gasUsed: bigint("gas_used", { mode: "bigint" }),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    eventDelegatedWei: wei("event_delegated_wei"),
    eventUndelegatedWei: wei("event_undelegated_wei"),
    eventClaimedWei: wei("event_claimed_wei"),
    error: text("error"),
    broadcastAt: tstz("broadcast_at"),
    confirmedAt: tstz("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("txs_wallet_id_nonce_idx").on(t.walletId, t.nonce),
    index("txs_position_id_created_at_idx").on(t.positionId, t.createdAt),
    check("txs_kind_check", inList(t.kind, TX_ROW_KINDS)),
    check("txs_status_check", inList(t.status, TX_STATUSES)),
  ],
);

// ---------------------------------------------------------------------------
// position_snapshots (one per check; pruned after 90 days)
// ---------------------------------------------------------------------------
export const positionSnapshots = pgTable(
  "position_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    takenAt: tstz("taken_at").notNull().defaultNow(),
    principalWei: wei("principal_wei").notNull(),
    pendingWei: wei("pending_wei").notNull(),
    aprEst: doublePrecision("apr_est"),
    rStarWei: wei("r_star_wei"),
    gasPriceWei: wei("gas_price_wei").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("position_snapshots_position_id_taken_at_idx").on(t.positionId, t.takenAt)],
);

// ---------------------------------------------------------------------------
// app_settings (single row, id = 1; seeded from env by the worker/migrate, edited in the settings page)
// ---------------------------------------------------------------------------
export const appSettings = pgTable(
  "app_settings",
  {
    id: smallint("id").primaryKey().default(1),
    gasReserveWei: wei("gas_reserve_wei").notNull(),
    maxGasPriceWei: wei("max_gas_price_wei").notNull(),
    minIntervalSec: integer("min_interval_sec").notNull(),
    rFloorWei: wei("r_floor_wei").notNull(),
    checkMinSec: integer("check_min_sec").notNull(),
    checkMaxSec: integer("check_max_sec").notNull(),
    validatorSyncSec: integer("validator_sync_sec").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("app_settings_single_row_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// worker_heartbeat (single row, id = 1; upserted every tick)
// ---------------------------------------------------------------------------
export const workerHeartbeat = pgTable(
  "worker_heartbeat",
  {
    id: smallint("id").primaryKey().default(1),
    instanceId: text("instance_id").notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    lastTickAt: tstz("last_tick_at").notNull().defaultNow(),
    tickCount: bigint("tick_count", { mode: "bigint" }).notNull().default(sql`0`),
    chainId: integer("chain_id"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    gasPriceWei: wei("gas_price_wei"),
    version: text("version").notNull(),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [check("worker_heartbeat_single_row_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// login_attempts (rate limit: 5 failures / 15 min / IP)
// ---------------------------------------------------------------------------
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    success: boolean("success").notNull(),
    attemptedAt: tstz("attempted_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_ip_attempted_at_idx").on(t.ip, t.attemptedAt)],
);

// ---------------------------------------------------------------------------
// admin_credentials (single row, id = 1; never seeded — no row means the admin password is not set yet)
// Separate from app_settings because getSettings selects every column and the worker reads it every tick.
// ---------------------------------------------------------------------------
export const adminCredentials = pgTable(
  "admin_credentials",
  {
    id: smallint("id").primaryKey().default(1),
    /** argon2id hash in PHC string format (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), never the password. */
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("admin_credentials_single_row_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// relations (for `db.query.*.findMany({ with: ... })`)
// ---------------------------------------------------------------------------
export const walletsRelations = relations(wallets, ({ many }) => ({
  positions: many(positions),
  txs: many(txs),
}));

export const validatorsRelations = relations(validators, ({ many }) => ({
  positions: many(positions),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  wallet: one(wallets, { fields: [positions.walletId], references: [wallets.id] }),
  validator: one(validators, { fields: [positions.validatorId], references: [validators.validatorId] }),
  actions: many(actions),
  txs: many(txs),
  snapshots: many(positionSnapshots),
}));

export const actionsRelations = relations(actions, ({ one, many }) => ({
  position: one(positions, { fields: [actions.positionId], references: [positions.id] }),
  /** the tx recorded in `actions.tx_id` */
  tx: one(txs, { fields: [actions.txId], references: [txs.id], relationName: "action_last_tx" }),
  /** every tx whose `txs.action_id` points at this action (2-tx compound = 2 rows) */
  txs: many(txs, { relationName: "action_txs" }),
}));

export const txsRelations = relations(txs, ({ one }) => ({
  wallet: one(wallets, { fields: [txs.walletId], references: [wallets.id] }),
  position: one(positions, { fields: [txs.positionId], references: [positions.id] }),
  action: one(actions, { fields: [txs.actionId], references: [actions.id], relationName: "action_txs" }),
}));

export const positionSnapshotsRelations = relations(positionSnapshots, ({ one }) => ({
  position: one(positions, { fields: [positionSnapshots.positionId], references: [positions.id] }),
}));

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export type WalletRow = typeof wallets.$inferSelect;
export type NewWalletRow = typeof wallets.$inferInsert;
export type WalletPublicRow = Omit<WalletRow, "encryptedKey">;
export type ValidatorRow = typeof validators.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type NewPositionRow = typeof positions.$inferInsert;
export type ActionRow = typeof actions.$inferSelect;
export type TxRow = typeof txs.$inferSelect;
export type NewTxRow = typeof txs.$inferInsert;
export type PositionSnapshotRow = typeof positionSnapshots.$inferSelect;
export type NewPositionSnapshotRow = typeof positionSnapshots.$inferInsert;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type WorkerHeartbeatRow = typeof workerHeartbeat.$inferSelect;
export type LoginAttemptRow = typeof loginAttempts.$inferSelect;
export type AdminCredentialRow = typeof adminCredentials.$inferSelect;
