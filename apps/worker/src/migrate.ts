import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadWorkerEnv } from "@kubstake/core";
import { createDb, ensureSettings, type SettingsSeed } from "@kubstake/db";
import { errMsg } from "./errors";
import { createLogger } from "./logger";

// One-shot migrate service (compose `migrate`): advisory lock → drizzle migrations → seed app_settings → exit.
// MIGRATIONS_DIR: docker image sets /app/drizzle; the default works from both src/ (tsx) and dist/ (bundle).

const MIGRATE_LOCK_NAME = "kubstake-migrate";

export function migrationsDir(env: Record<string, string | undefined> = process.env): string {
  return env.MIGRATIONS_DIR || path.join(__dirname, "../../../packages/db/drizzle");
}

/**
 * app_settings seed from GAS_RESERVE_KUB / MAX_GAS_PRICE_GWEI / ... with the same validation and defaults as
 * the worker. migrate does not need (and must not require) MASTER_KEY, so a placeholder satisfies the schema;
 * it is never used for any cryptography.
 */
export function settingsSeedFromEnv(env: Record<string, string | undefined> = process.env): SettingsSeed {
  return loadWorkerEnv({ ...env, MASTER_KEY: Buffer.alloc(32).toString("base64") }).settingsSeed;
}

async function main(): Promise<number> {
  const log = createLogger("info", { name: "migrate" });
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.fatal("DATABASE_URL is required");
    return 1;
  }
  let seed: SettingsSeed;
  try {
    seed = settingsSeedFromEnv();
  } catch (err) {
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, "invalid settings seed environment");
    return 1;
  }
  const folder = migrationsDir();
  const { db, pool } = createDb(url, { max: 2, onError: (err) => log.warn({ err: errMsg(err) }, "idle client error") });
  try {
    const lockClient = await pool.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATE_LOCK_NAME]);
      log.info({ migrationsFolder: folder }, "applying migrations");
      // On this client, not `db`: the migrator calls `session.transaction` itself, past the override in `createDb`.
      await migrate(drizzle(lockClient), { migrationsFolder: folder });
      const settings = await ensureSettings(db, seed);
      log.info({ settingsId: settings.id }, "migrations applied; app_settings ready");
      await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATE_LOCK_NAME]);
    } finally {
      lockClient.release();
    }
    return 0;
  } catch (err) {
    log.fatal({ err: errMsg(err, 2000) }, "migration failed");
    return 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`migrate crashed: ${errMsg(err)}`);
    process.exit(1);
  },
);
