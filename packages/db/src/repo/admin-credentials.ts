import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { adminCredentials } from "../schema";

// Hashes are opaque strings here: argon2 lives in apps/web only, because the worker image does not ship it.

const ADMIN_CREDENTIAL_ID = 1;

/** The stored hash, or `null` when no admin password has been set yet. */
export async function getAdminPasswordHash(db: DbExecutor): Promise<string | null> {
  const [row] = await db
    .select({ passwordHash: adminCredentials.passwordHash })
    .from(adminCredentials)
    .where(eq(adminCredentials.id, ADMIN_CREDENTIAL_ID))
    .limit(1);
  return row?.passwordHash ?? null;
}

/**
 * Stores the first admin password hash. An existing row always wins, so of any number of concurrent callers
 * exactly one gets `true`; every other caller gets `false` and has written nothing.
 */
export async function createAdminCredential(db: DbExecutor, passwordHash: string): Promise<boolean> {
  const rows = await db
    .insert(adminCredentials)
    .values({ id: ADMIN_CREDENTIAL_ID, passwordHash })
    .onConflictDoNothing({ target: adminCredentials.id })
    .returning({ id: adminCredentials.id });
  return rows.length === 1;
}

/**
 * Swaps the hash only if it is still `expectedHash` (compare-and-swap), so a change based on a stale read cannot
 * overwrite a newer password. Returns `false` and writes nothing when the hash differs or the row is gone.
 */
export async function replaceAdminPasswordHash(
  db: DbExecutor,
  expectedHash: string,
  newHash: string,
): Promise<boolean> {
  const rows = await db
    .update(adminCredentials)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(adminCredentials.passwordHash, expectedHash))
    .returning({ id: adminCredentials.id });
  return rows.length === 1;
}
