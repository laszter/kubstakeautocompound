import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { decryptPrivateKey } from "@kubstake/core";
import { wallets, type DbExecutor } from "@kubstake/db";
import { KeyAddressMismatchError } from "./errors";
import type { TxSigner } from "./txManager";

// The ONLY place in the system that decrypts wallet keys (the web app is encrypt-only).
// Keys are decrypted per transaction and never cached; the returned signer only exposes address + signing.

/** Decrypt `encryptedKey` (AAD = lowercase address) and assert it derives `address`. */
export function signerFromEncrypted(masterKey: Uint8Array, address: string, encryptedKey: string): TxSigner {
  const expected: Address = getAddress(address);
  const account = privateKeyToAccount(decryptPrivateKey(masterKey, encryptedKey, expected.toLowerCase()));
  if (account.address !== expected) throw new KeyAddressMismatchError(expected);
  return {
    address: account.address,
    signTransaction: (tx) => account.signTransaction(tx),
  };
}

/** Loads `wallets.encrypted_key` itself (getPositionWithRelations deliberately omits it). */
export async function loadAccount(db: DbExecutor, masterKey: Uint8Array, walletId: string): Promise<TxSigner> {
  const [w] = await db
    .select({ address: wallets.address, encryptedKey: wallets.encryptedKey })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .limit(1);
  if (!w) throw new Error(`wallet ${walletId} not found`);
  return signerFromEncrypted(masterKey, w.address, w.encryptedKey);
}

export type AccountLoader = { load(walletId: string): Promise<TxSigner> };

export function createAccountLoader(db: DbExecutor, masterKey: Uint8Array): AccountLoader {
  return { load: (walletId) => loadAccount(db, masterKey, walletId) };
}
