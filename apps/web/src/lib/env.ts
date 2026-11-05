import "server-only";
import { loadWebEnv, type WebEnv } from "@kubstake/core";

let cached: WebEnv | undefined;

/** Validates process.env on first call (throws listing variable names only, never values) and caches it. */
export function getEnv(): WebEnv {
  cached ??= loadWebEnv();
  return cached;
}

/**
 * Lazy web env: each property is read through `getEnv()` on access, so importing this module never
 * validates anything — `next build` works without DATABASE_URL / MASTER_KEY / ... being set.
 */
export const env = {
  get DATABASE_URL() {
    return getEnv().DATABASE_URL;
  },
  get MASTER_KEY() {
    return getEnv().MASTER_KEY;
  },
  get SESSION_SECRET() {
    return getEnv().SESSION_SECRET;
  },
  get COOKIE_SECURE() {
    return getEnv().COOKIE_SECURE;
  },
  get SESSION_TTL_SEC() {
    return getEnv().SESSION_TTL_SEC;
  },
  get EXPLORER_URL() {
    return getEnv().EXPLORER_URL;
  },
  get APP_TIMEZONE() {
    return getEnv().APP_TIMEZONE;
  },
} satisfies WebEnv;
