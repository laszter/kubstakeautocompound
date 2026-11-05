import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

// AES-256-GCM envelope for wallet private keys (TASK §Security model):
//   blob = "v1:<iv b64>:<tag b64>:<ct b64>", IV 12 random bytes per encryption, tag 16 bytes,
//   AAD = caller-supplied string (the wallet address, lowercase), plaintext = the 32 raw key bytes.
// Errors never include key material.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** secp256k1 group order — valid private keys are 1..n-1. */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HEX32 = /^0x[0-9a-f]{64}$/;

function assertMasterKey(masterKey: Uint8Array): void {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== KEY_BYTES) {
    throw new Error("master key must be exactly 32 bytes");
  }
}

const privateKeySchema = z
  .string()
  .transform((v) => {
    const t = v.trim();
    return (t.startsWith("0x") || t.startsWith("0X") ? `0x${t.slice(2)}` : `0x${t}`).toLowerCase();
  })
  .refine((v) => HEX32.test(v), { message: "private key must be 32 bytes of hex (64 hex chars, optional 0x)", abort: true })
  .refine(
    (v) => {
      // zod may still run this after the format check failed — never feed non-hex to BigInt
      // (its error message would echo the input).
      if (!HEX32.test(v)) return true;
      const n = BigInt(v);
      return n > 0n && n < SECP256K1_N;
    },
    { message: "private key is out of range for secp256k1" },
  );

/** trim → add 0x → lowercase → validate 32-byte hex in secp256k1 range. Throws ZodError (without echoing the input). */
export function normalizePrivateKey(input: string): Hex {
  return privateKeySchema.parse(input) as Hex;
}

/** Checksummed address of a private key. */
export function deriveAddress(privateKey: Hex): Address {
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

export function encryptPrivateKey(masterKey: Uint8Array, privateKey: Hex, aad: string): string {
  assertMasterKey(masterKey);
  const pk = normalizePrivateKey(privateKey);
  const plain = Buffer.from(pk.slice(2), "hex");
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  } finally {
    plain.fill(0);
  }
}

/** Throws on malformed blob, tampered ciphertext/tag, wrong master key or wrong AAD. */
export function decryptPrivateKey(masterKey: Uint8Array, blob: string, aad: string): Hex {
  assertMasterKey(masterKey);
  const parts = typeof blob === "string" ? blob.split(":") : [];
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("decryptPrivateKey: unsupported or malformed blob");
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length !== KEY_BYTES) {
    throw new Error("decryptPrivateKey: malformed blob");
  }
  let plain: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error("decryptPrivateKey: authentication failed (wrong master key, wrong AAD or tampered data)");
  }
  try {
    if (plain.length !== KEY_BYTES) throw new Error("decryptPrivateKey: unexpected plaintext length");
    return `0x${plain.toString("hex")}` as Hex;
  } finally {
    plain.fill(0);
  }
}
