import "server-only";
import { createDb, type Db } from "@kubstake/db";
import { env } from "./env";

/** A DB that accepts connections but never answers (e.g. `docker compose pause db`) must not hang new connections. */
const CONNECTION_TIMEOUT_MS = 5_000;

// Kept on globalThis so `next dev` hot reloads reuse one pool instead of leaking a new one per reload.
const g = globalThis as typeof globalThis & { __kubstakeWebDb?: Db };

/** Shared Drizzle client (pg pool max 5), created on first use. Never select `wallets.encrypted_key` in web. */
export function getDb(): Db {
  g.__kubstakeWebDb ??= createDb(env.DATABASE_URL, {
    max: 5,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  }).db;
  return g.__kubstakeWebDb;
}
