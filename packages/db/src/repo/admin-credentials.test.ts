import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "../client";
import * as schema from "../schema";
import { createAdminCredential, getAdminPasswordHash, replaceAdminPasswordHash } from "./admin-credentials";

const OLD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$b2xkc2FsdA$b2xkaGFzaA";
const NEW_HASH = "$argon2id$v=19$m=19456,t=2,p=1$bmV3c2FsdA$bmV3aGFzaA";

type Sent = { text: string; params: unknown[] };

/** A real drizzle executor over a fake pg client: the SQL and params are the ones production would send. */
function fakeDb(rows: unknown[][]): { db: DbExecutor; sent: Sent[] } {
  const sent: Sent[] = [];
  const query = vi.fn(async (config: { text: string }, params: unknown[]) => {
    sent.push({ text: config.text, params });
    return { rows, rowCount: rows.length };
  });
  const db = drizzle({ client: { query } as never, schema }) as unknown as DbExecutor;
  return { db, sent };
}

describe("getAdminPasswordHash", () => {
  it("returns the stored hash, selecting only that column of the single row", async () => {
    const { db, sent } = fakeDb([[OLD_HASH]]);
    await expect(getAdminPasswordHash(db)).resolves.toBe(OLD_HASH);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toMatch(/^select "password_hash" from "admin_credentials" where "admin_credentials"."id" = \$1/);
    expect(sent[0]?.params[0]).toBe(1);
  });

  it("returns null when the password is not set yet", async () => {
    const { db } = fakeDb([]);
    await expect(getAdminPasswordHash(db)).resolves.toBeNull();
  });
});

describe("createAdminCredential", () => {
  it("returns true when the row was inserted", async () => {
    const { db, sent } = fakeDb([[1]]);
    await expect(createAdminCredential(db, NEW_HASH)).resolves.toBe(true);
    expect(sent[0]?.text).toMatch(/^insert into "admin_credentials"/);
    expect(sent[0]?.text).toContain('on conflict ("id") do nothing');
    expect(sent[0]?.text).toContain('returning "id"');
    expect(sent[0]?.params).toContain(NEW_HASH);
    expect(sent[0]?.params).toContain(1);
  });

  it("returns false when a row already exists, so the loser of a race never overwrites", async () => {
    const { db, sent } = fakeDb([]);
    await expect(createAdminCredential(db, NEW_HASH)).resolves.toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain("do update");
  });
});

describe("replaceAdminPasswordHash", () => {
  it("returns true when the expected hash matched, and also bumps updated_at", async () => {
    const { db, sent } = fakeDb([[1]]);
    await expect(replaceAdminPasswordHash(db, OLD_HASH, NEW_HASH)).resolves.toBe(true);
    expect(sent[0]?.text).toMatch(/^update "admin_credentials" set /);
    expect(sent[0]?.text).toContain('"updated_at" = $');
    expect(sent[0]?.text).toContain('where "admin_credentials"."password_hash" = $');
    expect(sent[0]?.text).toContain('returning "id"');
    expect(sent[0]?.params).toContain(NEW_HASH);
    expect(sent[0]?.params.at(-1)).toBe(OLD_HASH);
  });

  it("returns false when the expected hash did not match", async () => {
    const { db } = fakeDb([]);
    await expect(replaceAdminPasswordHash(db, "stale", NEW_HASH)).resolves.toBe(false);
  });
});
