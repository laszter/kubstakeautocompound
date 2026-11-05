import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { positions, type PositionRow, type ValidatorRow, type WalletPublicRow } from "../schema";

export type PositionWithRelations = PositionRow & { wallet: WalletPublicRow; validator: ValidatorRow };

/**
 * Position + its wallet + validator. The wallet's `encryptedKey` is deliberately NOT selected so this is
 * safe to use from the web app; the worker loads the ciphertext separately when it needs to sign.
 */
export async function getPositionWithRelations(db: DbExecutor, id: string): Promise<PositionWithRelations | null> {
  const row = await db.query.positions.findFirst({
    where: eq(positions.id, id),
    with: {
      wallet: { columns: { encryptedKey: false } },
      validator: true,
    },
  });
  return row ?? null;
}
