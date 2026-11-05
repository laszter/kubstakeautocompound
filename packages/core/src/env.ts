import { z } from "zod";
import { EXPLORER_URL_DEFAULT, RPC_URL_DEFAULT, SUBGRAPH_URL_DEFAULT } from "./chain/addresses";
import { gweiToWei, parseKub } from "./format";

/** KUB Mainnet. The only chain this app supports. */
export const CHAIN_ID = 96 as const;

type EnvSource = Record<string, string | undefined>;

/** Env vars where an explicitly empty value is meaningful (not treated as "unset"). */
const KEEP_EMPTY = new Set(["SUBGRAPH_URL"]);

/** Treat `VAR=` (empty) as unset so defaults apply — docker compose often passes empty strings. */
function clean(src: EnvSource): EnvSource {
  const out: EnvSource = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = v === "" && !KEEP_EMPTY.has(k) ? undefined : v;
  }
  return out;
}

/** Parses MASTER_KEY: base64 of exactly 32 bytes (`openssl rand -base64 32`). Throws otherwise. */
export function parseMasterKey(b64: string): Uint8Array {
  const s = (b64 ?? "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    throw new Error("MASTER_KEY must be base64 (generate with: openssl rand -base64 32)");
  }
  const buf = Buffer.from(s, "base64");
  if (buf.length !== 32 || buf.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) {
    throw new Error(`MASTER_KEY must decode to exactly 32 bytes (got ${buf.length})`);
  }
  return new Uint8Array(buf);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const stripSlash = (v: string) => v.replace(/\/+$/, "");

/**
 * Ranges for the app_settings seed vars — identical to SETTINGS_LIMITS of the web settings page
 * (apps/web/src/app/(app)/settings/settings-fields.ts), so a seed the env accepts is always editable there.
 * Keep the two in sync.
 */
const SEED_LIMITS = {
  gasReserveMinKub: "0.05",
  maxGasPriceMinGwei: "1",
  maxGasPriceMaxGwei: "1000",
  minIntervalMinSec: 3600,
  checkMinMinSec: 300,
  validatorSyncMinSec: 300,
  maxSec: 31_536_000,
} as const;

const intWithDefault = (def: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const boolWithDefault = (def: boolean) => z.stringbool().default(def);

const kubAmount = (def: string, minWei: bigint, label: string) =>
  z
    .string()
    .refine((v) => {
      try {
        return parseKub(v) >= minWei;
      } catch {
        return false;
      }
    }, `must be a KUB decimal ${label}`)
    .default(def);

const masterKey = z.string().refine((v) => {
  try {
    parseMasterKey(v);
    return true;
  } catch {
    return false;
  }
}, "must be base64 of exactly 32 bytes (openssl rand -base64 32)");

const databaseUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\/.+/.test(v), "must be a postgres:// or postgresql:// URL");

const httpUrl = (def: string) =>
  z.string().refine(isHttpUrl, "must be an http(s) URL").transform(stripSlash).default(def);

const timezone = z.string().refine(isValidTimeZone, "must be a valid IANA timezone").default("Asia/Bangkok");

const webSchema = z.object({
  DATABASE_URL: databaseUrl,
  MASTER_KEY: masterKey,
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters (openssl rand -base64 48)"),
  COOKIE_SECURE: boolWithDefault(false),
  SESSION_TTL_SEC: intWithDefault(43_200, 60),
  EXPLORER_URL: httpUrl(EXPLORER_URL_DEFAULT),
  APP_TIMEZONE: timezone,
});

const workerSchema = z
  .object({
    DATABASE_URL: databaseUrl,
    MASTER_KEY: masterKey,
    RPC_URL: httpUrl(RPC_URL_DEFAULT),
    CHAIN_ID: z.coerce.number().pipe(z.literal(CHAIN_ID)).default(CHAIN_ID),
    DRY_RUN: boolWithDefault(true),
    TICK_INTERVAL_SEC: intWithDefault(30, 5, 3600),
    RPC_CONCURRENCY: intWithDefault(4, 1, 4),
    /** Unset → default subgraph; explicitly empty → subgraph disabled. */
    SUBGRAPH_URL: z
      .string()
      .refine((v) => v === "" || isHttpUrl(v), "must be an http(s) URL or empty (disabled)")
      .default(SUBGRAPH_URL_DEFAULT),
    APP_TIMEZONE: timezone,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // app_settings seed (first boot only; editable later in the settings page)
    GAS_RESERVE_KUB: kubAmount("0.05", parseKub(SEED_LIMITS.gasReserveMinKub), `>= ${SEED_LIMITS.gasReserveMinKub}`),
    MAX_GAS_PRICE_GWEI: z
      .string()
      .refine((v) => {
        try {
          const wei = gweiToWei(v);
          return wei >= gweiToWei(SEED_LIMITS.maxGasPriceMinGwei) && wei <= gweiToWei(SEED_LIMITS.maxGasPriceMaxGwei);
        } catch {
          return false;
        }
      }, `must be a gwei decimal between ${SEED_LIMITS.maxGasPriceMinGwei} and ${SEED_LIMITS.maxGasPriceMaxGwei}`)
      .default("50"),
    MIN_INTERVAL_SEC: intWithDefault(3600, SEED_LIMITS.minIntervalMinSec, SEED_LIMITS.maxSec),
    R_FLOOR_KUB: kubAmount("0.5", 0n, ">= 0"),
    CHECK_MIN_SEC: intWithDefault(900, SEED_LIMITS.checkMinMinSec, SEED_LIMITS.maxSec),
    CHECK_MAX_SEC: intWithDefault(21_600, SEED_LIMITS.checkMinMinSec, SEED_LIMITS.maxSec),
    VALIDATOR_SYNC_SEC: intWithDefault(1800, SEED_LIMITS.validatorSyncMinSec, SEED_LIMITS.maxSec),
  })
  .refine((e) => e.CHECK_MIN_SEC <= e.CHECK_MAX_SEC, {
    message: "CHECK_MIN_SEC must be <= CHECK_MAX_SEC",
    path: ["CHECK_MIN_SEC"],
  });

export type WebEnv = z.output<typeof webSchema>;

/** Shape matches `SettingsSeed` of `@kubstake/db` (ensureSettings). */
export type EnvSettingsSeed = {
  gasReserveWei: bigint;
  maxGasPriceWei: bigint;
  minIntervalSec: number;
  rFloorWei: bigint;
  checkMinSec: number;
  checkMaxSec: number;
  validatorSyncSec: number;
};

export type WorkerEnv = z.output<typeof workerSchema> & {
  /** Derived from GAS_RESERVE_KUB / MAX_GAS_PRICE_GWEI / ... (wei as bigint). */
  settingsSeed: EnvSettingsSeed;
};

/** Error message lists variable names + reasons only — never the (possibly secret) values. */
function formatIssues(scope: string, issues: z.ZodError["issues"]): Error {
  const lines = issues.map((i) => `  - ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
  return new Error(`Invalid ${scope} environment:\n${lines.join("\n")}`);
}

export function loadWebEnv(src: EnvSource = process.env): WebEnv {
  const r = webSchema.safeParse(clean(src));
  if (!r.success) throw formatIssues("web", r.error.issues);
  return r.data;
}

export function loadWorkerEnv(src: EnvSource = process.env): WorkerEnv {
  const r = workerSchema.safeParse(clean(src));
  if (!r.success) throw formatIssues("worker", r.error.issues);
  const e = r.data;
  return {
    ...e,
    settingsSeed: {
      gasReserveWei: parseKub(e.GAS_RESERVE_KUB),
      maxGasPriceWei: gweiToWei(e.MAX_GAS_PRICE_GWEI),
      minIntervalSec: e.MIN_INTERVAL_SEC,
      rFloorWei: parseKub(e.R_FLOOR_KUB),
      checkMinSec: e.CHECK_MIN_SEC,
      checkMaxSec: e.CHECK_MAX_SEC,
      validatorSyncSec: e.VALIDATOR_SYNC_SEC,
    },
  };
}
