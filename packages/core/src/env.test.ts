import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CHAIN_ID, loadWebEnv, loadWorkerEnv } from "./env";

const MASTER_KEY = randomBytes(32).toString("base64");
const base = { DATABASE_URL: "postgres://u:p@db:5432/kubstake", MASTER_KEY };

describe("loadWebEnv", () => {
  const web = { ...base, SESSION_SECRET: "x".repeat(48) };

  it("applies defaults", () => {
    const e = loadWebEnv(web);
    expect(e).toMatchObject({
      COOKIE_SECURE: false,
      SESSION_TTL_SEC: 43_200,
      EXPLORER_URL: "https://www.kubscan.com",
      APP_TIMEZONE: "Asia/Bangkok",
    });
    expect(e.MASTER_KEY).toBe(MASTER_KEY);
  });

  it("parses overrides and treats empty strings as unset", () => {
    const e = loadWebEnv({ ...web, COOKIE_SECURE: "true", SESSION_TTL_SEC: "600", EXPLORER_URL: "https://scan.example/", APP_TIMEZONE: "" });
    expect(e).toMatchObject({ COOKIE_SECURE: true, SESSION_TTL_SEC: 600, EXPLORER_URL: "https://scan.example", APP_TIMEZONE: "Asia/Bangkok" });
  });

  it("rejects bad secrets without echoing values", () => {
    const secret = "short-secret";
    expect(() => loadWebEnv({ ...web, SESSION_SECRET: secret })).toThrow(/SESSION_SECRET/);
    try {
      loadWebEnv({ ...web, SESSION_SECRET: secret, MASTER_KEY: "abc" });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/SESSION_SECRET/);
      expect(msg).toMatch(/MASTER_KEY/);
      expect(msg).not.toContain(secret);
    }
    expect(() => loadWebEnv({ ...web, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadWebEnv({ ...web, APP_TIMEZONE: "Not/AZone" })).toThrow(/APP_TIMEZONE/);
  });
});

describe("loadWorkerEnv", () => {
  it("applies defaults (DRY_RUN=true) and derives the settings seed in wei", () => {
    const e = loadWorkerEnv(base);
    expect(e).toMatchObject({
      RPC_URL: "https://rpc.kubchain.io",
      CHAIN_ID: CHAIN_ID,
      DRY_RUN: true,
      TICK_INTERVAL_SEC: 30,
      RPC_CONCURRENCY: 4,
      SUBGRAPH_URL: "https://gateway.bitkubgraph.io/subgraphs/name/bitkubchain/pos",
      LOG_LEVEL: "info",
      GAS_RESERVE_KUB: "0.05",
      MAX_GAS_PRICE_GWEI: "50",
      MIN_INTERVAL_SEC: 3600,
      R_FLOOR_KUB: "0.5",
      CHECK_MIN_SEC: 900,
      CHECK_MAX_SEC: 21_600,
      VALIDATOR_SYNC_SEC: 1800,
    });
    expect(e.settingsSeed).toEqual({
      gasReserveWei: 50_000_000_000_000_000n,
      maxGasPriceWei: 50_000_000_000n,
      minIntervalSec: 3600,
      rFloorWei: 500_000_000_000_000_000n,
      checkMinSec: 900,
      checkMaxSec: 21_600,
      validatorSyncSec: 1800,
    });
  });

  it("DRY_RUN must be explicitly false to send transactions", () => {
    expect(loadWorkerEnv({ ...base, DRY_RUN: "" }).DRY_RUN).toBe(true);
    expect(loadWorkerEnv({ ...base, DRY_RUN: "false" }).DRY_RUN).toBe(false);
    expect(() => loadWorkerEnv({ ...base, DRY_RUN: "maybe" })).toThrow(/DRY_RUN/);
  });

  it("SUBGRAPH_URL='' disables the subgraph", () => {
    expect(loadWorkerEnv({ ...base, SUBGRAPH_URL: "" }).SUBGRAPH_URL).toBe("");
  });

  it("rejects non-96 chain ids and unsafe settings", () => {
    expect(() => loadWorkerEnv({ ...base, CHAIN_ID: "25925" })).toThrow(/CHAIN_ID/);
    expect(loadWorkerEnv({ ...base, CHAIN_ID: "96" }).CHAIN_ID).toBe(96);
    expect(() => loadWorkerEnv({ ...base, GAS_RESERVE_KUB: "0.01" })).toThrow(/GAS_RESERVE_KUB/);
    expect(() => loadWorkerEnv({ ...base, MIN_INTERVAL_SEC: "60" })).toThrow(/MIN_INTERVAL_SEC/);
    expect(() => loadWorkerEnv({ ...base, CHECK_MIN_SEC: "30000" })).toThrow(/CHECK_MIN_SEC/);
    expect(() => loadWorkerEnv({ ...base, RPC_URL: "ftp://x" })).toThrow(/RPC_URL/);
    expect(() => loadWorkerEnv({ ...base, MASTER_KEY: randomBytes(16).toString("base64") })).toThrow(/MASTER_KEY/);
  });

  it("seed ranges match the settings page (SETTINGS_LIMITS)", () => {
    // lower bounds: CHECK_MIN/CHECK_MAX/VALIDATOR_SYNC >= 300, MIN_INTERVAL >= 3600
    expect(() => loadWorkerEnv({ ...base, CHECK_MIN_SEC: "299" })).toThrow(/CHECK_MIN_SEC/);
    expect(() => loadWorkerEnv({ ...base, CHECK_MIN_SEC: "300", CHECK_MAX_SEC: "299" })).toThrow(/CHECK_MAX_SEC/);
    expect(() => loadWorkerEnv({ ...base, VALIDATOR_SYNC_SEC: "299" })).toThrow(/VALIDATOR_SYNC_SEC/);
    expect(() => loadWorkerEnv({ ...base, MIN_INTERVAL_SEC: "3599" })).toThrow(/MIN_INTERVAL_SEC/);
    expect(loadWorkerEnv({ ...base, CHECK_MIN_SEC: "300", CHECK_MAX_SEC: "300", VALIDATOR_SYNC_SEC: "300" }).settingsSeed).toMatchObject({
      checkMinSec: 300,
      checkMaxSec: 300,
      validatorSyncSec: 300,
    });
    // upper bound for every seconds field: 365 days
    expect(loadWorkerEnv({ ...base, CHECK_MAX_SEC: "31536000", MIN_INTERVAL_SEC: "31536000", VALIDATOR_SYNC_SEC: "31536000" }).CHECK_MAX_SEC).toBe(31_536_000);
    expect(() => loadWorkerEnv({ ...base, CHECK_MAX_SEC: "31536001" })).toThrow(/CHECK_MAX_SEC/);
    expect(() => loadWorkerEnv({ ...base, MIN_INTERVAL_SEC: "31536001" })).toThrow(/MIN_INTERVAL_SEC/);
    expect(() => loadWorkerEnv({ ...base, VALIDATOR_SYNC_SEC: "31536001" })).toThrow(/VALIDATOR_SYNC_SEC/);
    // max gas price: 1–1000 gwei
    expect(loadWorkerEnv({ ...base, MAX_GAS_PRICE_GWEI: "1" }).settingsSeed.maxGasPriceWei).toBe(1_000_000_000n);
    expect(loadWorkerEnv({ ...base, MAX_GAS_PRICE_GWEI: "1000" }).settingsSeed.maxGasPriceWei).toBe(1_000_000_000_000n);
    expect(() => loadWorkerEnv({ ...base, MAX_GAS_PRICE_GWEI: "0.5" })).toThrow(/MAX_GAS_PRICE_GWEI/);
    expect(() => loadWorkerEnv({ ...base, MAX_GAS_PRICE_GWEI: "1000.1" })).toThrow(/MAX_GAS_PRICE_GWEI/);
    // gas reserve >= 0.05 KUB, R floor >= 0
    expect(loadWorkerEnv({ ...base, GAS_RESERVE_KUB: "0.05", R_FLOOR_KUB: "0" }).settingsSeed).toMatchObject({
      gasReserveWei: 50_000_000_000_000_000n,
      rFloorWei: 0n,
    });
  });
});
