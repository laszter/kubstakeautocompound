import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { schema, wei } from "./index";

const MAX_UINT256 = 2n ** 256n - 1n;

/** db (snake_case) column names of a table */
function dbColumnNames(table: PgTable): string[] {
  return Object.values(getTableColumns(table)).map((c) => (c as PgColumn).name);
}

/** every column whose SQL type is the `wei` customType */
function weiColumns(table: PgTable): string[] {
  return Object.values(getTableColumns(table))
    .filter((c) => (c as PgColumn).getSQLType() === "numeric(78,0)")
    .map((c) => (c as PgColumn).name);
}

describe("wei column", () => {
  const col = getTableColumns(schema.positions).principalWei;

  it("is numeric(78,0)", () => {
    expect(col.getSQLType()).toBe("numeric(78,0)");
    expect(typeof wei).toBe("function");
  });

  it("toDriver serializes bigint as a decimal string (no float, no exponent)", () => {
    expect(col.mapToDriverValue(0n)).toBe("0");
    expect(col.mapToDriverValue(1_500_000_000_000_000_000n)).toBe("1500000000000000000");
    expect(col.mapToDriverValue(MAX_UINT256)).toBe(MAX_UINT256.toString());
    expect(MAX_UINT256.toString()).toHaveLength(78);
  });

  it("fromDriver parses the numeric string back to bigint", () => {
    expect(col.mapFromDriverValue("0")).toBe(0n);
    expect(col.mapFromDriverValue("1234567890000000000")).toBe(1_234_567_890_000_000_000n);
    expect(col.mapFromDriverValue(MAX_UINT256.toString())).toBe(MAX_UINT256);
  });

  it("roundtrips", () => {
    for (const v of [0n, 1n, 10n ** 18n, 123_456_789_012_345_678_901_234_567_890n, MAX_UINT256]) {
      expect(col.mapFromDriverValue(col.mapToDriverValue(v))).toBe(v);
    }
  });
});

describe("schema", () => {
  it("defines exactly the 10 tables", () => {
    const tables = [
      schema.wallets,
      schema.validators,
      schema.positions,
      schema.actions,
      schema.txs,
      schema.positionSnapshots,
      schema.appSettings,
      schema.workerHeartbeat,
      schema.loginAttempts,
      schema.adminCredentials,
    ].map((t) => getTableName(t));
    expect(tables).toEqual([
      "wallets",
      "validators",
      "positions",
      "actions",
      "txs",
      "position_snapshots",
      "app_settings",
      "worker_heartbeat",
      "login_attempts",
      "admin_credentials",
    ]);
  });

  it("every table has created_at timestamptz default now()", () => {
    for (const t of [
      schema.wallets,
      schema.validators,
      schema.positions,
      schema.actions,
      schema.txs,
      schema.positionSnapshots,
      schema.appSettings,
      schema.workerHeartbeat,
      schema.loginAttempts,
      schema.adminCredentials,
    ]) {
      const createdAt = getTableColumns(t).createdAt as PgColumn | undefined;
      expect(createdAt, getTableName(t)).toBeDefined();
      expect(createdAt?.name).toBe("created_at");
      expect(createdAt?.getSQLType()).toBe("timestamp with time zone");
      expect(createdAt?.notNull).toBe(true);
      expect(createdAt?.hasDefault).toBe(true);
    }
  });

  it("positions has every column from the contract (snake_case)", () => {
    expect(dbColumnNames(schema.positions).sort()).toEqual(
      [
        "id",
        "wallet_id",
        "validator_id",
        "enabled",
        "strategy",
        "threshold_wei",
        "cron_expr",
        "min_reward_wei",
        "next_run_at",
        "principal_wei",
        "pending_wei",
        "liquid_wei",
        "chain_synced_at",
        "apr_est",
        "r_star_wei",
        "eta_sec",
        "next_check_at",
        "last_check_at",
        "last_compound_at",
        "last_run_at",
        "last_run_result",
        "claim_only",
        "backoff_level",
        "last_failure_at",
        "last_error",
        "created_at",
        "updated_at",
      ].sort(),
    );
  });

  it("positions defaults / nullability / strategy constraint", () => {
    const c = getTableColumns(schema.positions);
    expect(c.strategy.default).toBe("optimal");
    expect(c.strategy.enumValues).toEqual(["optimal", "threshold", "schedule"]);
    expect(c.enabled.default).toBe(true);
    expect(c.claimOnly.default).toBe(false);
    expect(c.backoffLevel.default).toBe(0);
    expect(c.principalWei.notNull && c.principalWei.hasDefault).toBe(true);
    expect(c.pendingWei.notNull && c.pendingWei.hasDefault).toBe(true);
    for (const nullable of [c.thresholdWei, c.cronExpr, c.minRewardWei, c.nextRunAt, c.liquidWei, c.aprEst, c.etaSec]) {
      expect(nullable.notNull, nullable.name).toBe(false);
    }
    expect(c.aprEst.getSQLType()).toBe("double precision");

    const cfg = getTableConfig(schema.positions);
    expect(cfg.checks.map((ch) => ch.name)).toEqual(["positions_strategy_check"]);
    expect(cfg.uniqueConstraints.map((u) => u.getName())).toEqual(["positions_wallet_validator_unique"]);
    const fks = cfg.foreignKeys.map((fk) => ({ cols: fk.reference().columns.map((x) => x.name), onDelete: fk.onDelete }));
    expect(fks).toContainEqual({ cols: ["wallet_id"], onDelete: "cascade" });
    expect(fks.find((f) => f.cols[0] === "validator_id")).toBeDefined();
  });

  it("all money columns use the wei type", () => {
    expect(weiColumns(schema.wallets)).toEqual(["balance_wei"]);
    expect(weiColumns(schema.validators).sort()).toEqual(
      ["delegated_wei", "min_delegated_wei", "self_stake_wei", "total_supply_wei"].sort(),
    );
    expect(weiColumns(schema.positions).sort()).toEqual(
      ["liquid_wei", "min_reward_wei", "pending_wei", "principal_wei", "r_star_wei", "threshold_wei"].sort(),
    );
    expect(weiColumns(schema.actions)).toEqual(["amount_wei"]);
    expect(weiColumns(schema.txs).sort()).toEqual(
      ["event_claimed_wei", "event_delegated_wei", "event_undelegated_wei", "gas_price_wei", "value_wei"].sort(),
    );
    expect(weiColumns(schema.positionSnapshots).sort()).toEqual(
      ["gas_price_wei", "pending_wei", "principal_wei", "r_star_wei"].sort(),
    );
    expect(weiColumns(schema.appSettings).sort()).toEqual(
      ["gas_reserve_wei", "max_gas_price_wei", "r_floor_wei"].sort(),
    );
    expect(weiColumns(schema.workerHeartbeat)).toEqual(["gas_price_wei"]);
  });

  it("check constraints on text enums and single-row tables", () => {
    const names = (t: PgTable) => getTableConfig(t).checks.map((c) => c.name).sort();
    expect(names(schema.actions)).toEqual(["actions_requested_by_check", "actions_status_check", "actions_type_check"]);
    expect(names(schema.txs)).toEqual(["txs_kind_check", "txs_status_check"]);
    expect(names(schema.appSettings)).toEqual(["app_settings_single_row_check"]);
    expect(names(schema.workerHeartbeat)).toEqual(["worker_heartbeat_single_row_check"]);
    expect(names(schema.adminCredentials)).toEqual(["admin_credentials_single_row_check"]);
  });

  it("admin_credentials is a singleton holding only the hash", () => {
    expect(dbColumnNames(schema.adminCredentials).sort()).toEqual(
      ["created_at", "id", "password_hash", "updated_at"].sort(),
    );
    const c = getTableColumns(schema.adminCredentials);
    expect(c.id.getSQLType()).toBe("smallint");
    expect(c.id.primary).toBe(true);
    expect(c.id.default).toBe(1);
    expect(c.passwordHash.getSQLType()).toBe("text");
    expect(c.passwordHash.notNull).toBe(true);
    expect(c.passwordHash.hasDefault).toBe(false);
    expect(c.updatedAt.notNull && c.updatedAt.hasDefault).toBe(true);
  });

  it("indexes from the contract", () => {
    const idx = (t: PgTable) =>
      getTableConfig(t).indexes.map((i) => ({
        name: i.config.name,
        cols: i.config.columns.map((c) => (c as PgColumn).name),
      }));
    expect(idx(schema.actions)).toEqual([{ name: "actions_status_created_at_idx", cols: ["status", "created_at"] }]);
    expect(idx(schema.txs)).toEqual([
      { name: "txs_wallet_id_nonce_idx", cols: ["wallet_id", "nonce"] },
      { name: "txs_position_id_created_at_idx", cols: ["position_id", "created_at"] },
    ]);
    expect(idx(schema.positionSnapshots)).toEqual([
      { name: "position_snapshots_position_id_taken_at_idx", cols: ["position_id", "taken_at"] },
    ]);
    expect(idx(schema.loginAttempts)).toEqual([
      { name: "login_attempts_ip_attempted_at_idx", cols: ["ip", "attempted_at"] },
    ]);
  });

  it("walletPublicColumns never includes the encrypted key", () => {
    const names = Object.values(schema.walletPublicColumns).map((c) => c.name);
    expect(names).not.toContain("encrypted_key");
    expect(names.length).toBe(dbColumnNames(schema.wallets).length - 1);
  });
});
