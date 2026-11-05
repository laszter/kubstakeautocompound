import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { decryptPrivateKey, deriveAddress, encryptPrivateKey, normalizePrivateKey } from "./crypto";
import { parseMasterKey } from "./env";

const newMaster = () => new Uint8Array(randomBytes(32));

function flipB64Byte(b64: string, index = 0): string {
  const buf = Buffer.from(b64, "base64");
  buf[index] = (buf[index] ?? 0) ^ 0x01;
  return buf.toString("base64");
}

describe("encryptPrivateKey / decryptPrivateKey (AES-256-GCM)", () => {
  const master = newMaster();
  const pk = generatePrivateKey();
  const aad = privateKeyToAccount(pk).address.toLowerCase();

  it("roundtrips", () => {
    const blob = encryptPrivateKey(master, pk, aad);
    expect(decryptPrivateKey(master, blob, aad)).toBe(pk);
  });

  it("uses the v1:iv:tag:ct format with 12-byte IV, 16-byte tag, 32-byte ciphertext", () => {
    const blob = encryptPrivateKey(master, pk, aad);
    const parts = blob.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1]!, "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2]!, "base64")).toHaveLength(16);
    expect(Buffer.from(parts[3]!, "base64")).toHaveLength(32);
    expect(blob).not.toContain(pk.slice(2));
  });

  it("uses a fresh IV per encryption", () => {
    const a = encryptPrivateKey(master, pk, aad);
    const b = encryptPrivateKey(master, pk, aad);
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
  });

  it("throws on tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptPrivateKey(master, pk, aad).split(":") as [string, string, string, string];
    expect(() => decryptPrivateKey(master, [v, iv, tag, flipB64Byte(ct, 5)].join(":"), aad)).toThrow();
  });

  it("throws on tampered tag", () => {
    const [v, iv, tag, ct] = encryptPrivateKey(master, pk, aad).split(":") as [string, string, string, string];
    expect(() => decryptPrivateKey(master, [v, iv, flipB64Byte(tag), ct].join(":"), aad)).toThrow();
  });

  it("throws on tampered IV", () => {
    const [v, iv, tag, ct] = encryptPrivateKey(master, pk, aad).split(":") as [string, string, string, string];
    expect(() => decryptPrivateKey(master, [v, flipB64Byte(iv), tag, ct].join(":"), aad)).toThrow();
  });

  it("throws on wrong AAD", () => {
    const blob = encryptPrivateKey(master, pk, aad);
    const other = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    expect(() => decryptPrivateKey(master, blob, other)).toThrow(/authentication failed/);
  });

  it("throws on wrong master key", () => {
    const blob = encryptPrivateKey(master, pk, aad);
    expect(() => decryptPrivateKey(newMaster(), blob, aad)).toThrow(/authentication failed/);
  });

  it("throws on malformed blobs and bad master keys", () => {
    expect(() => decryptPrivateKey(master, "garbage", aad)).toThrow();
    expect(() => decryptPrivateKey(master, "v2:a:b:c", aad)).toThrow();
    expect(() => decryptPrivateKey(master, "v1:AAAA:BBBB:CCCC", aad)).toThrow();
    expect(() => encryptPrivateKey(new Uint8Array(16), pk, aad)).toThrow(/32 bytes/);
    expect(() => decryptPrivateKey(new Uint8Array(31), "v1:a:b:c", aad)).toThrow(/32 bytes/);
  });

  it("error messages never contain key material", () => {
    const blob = encryptPrivateKey(master, pk, aad);
    try {
      decryptPrivateKey(newMaster(), blob, aad);
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(pk.slice(2));
    }
  });
});

describe("normalizePrivateKey", () => {
  const pk = generatePrivateKey();

  it("accepts with/without 0x, whitespace and uppercase", () => {
    expect(normalizePrivateKey(pk)).toBe(pk);
    expect(normalizePrivateKey(pk.slice(2))).toBe(pk);
    expect(normalizePrivateKey(`  ${pk}\n`)).toBe(pk);
    expect(normalizePrivateKey(`0X${pk.slice(2).toUpperCase()}`)).toBe(pk);
  });

  it("rejects invalid keys without echoing the input", () => {
    const bad = ["", "0x", "0x1234", `${pk}00`, `0x${"g".repeat(64)}`, `0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`];
    for (const b of bad) {
      let msg = "";
      try {
        normalizePrivateKey(b);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, `should reject ${b.length} chars`).not.toBe("");
      if (b.length > 10) expect(msg).not.toContain(b.slice(4));
    }
  });
});

describe("deriveAddress", () => {
  it("matches viem privateKeyToAccount (checksummed)", () => {
    const pk = generatePrivateKey();
    const addr = deriveAddress(pk);
    expect(addr).toBe(privateKeyToAccount(pk).address);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addr).not.toBe(addr.toLowerCase());
  });
});

describe("parseMasterKey", () => {
  it("accepts base64 of 32 bytes", () => {
    const b64 = randomBytes(32).toString("base64");
    const key = parseMasterKey(b64);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key).toHaveLength(32);
    expect(Buffer.from(key).toString("base64")).toBe(b64);
    expect(parseMasterKey(`${b64}\n`)).toHaveLength(32);
  });

  it("rejects wrong lengths and non-base64", () => {
    expect(() => parseMasterKey(randomBytes(31).toString("base64"))).toThrow();
    expect(() => parseMasterKey(randomBytes(33).toString("base64"))).toThrow();
    expect(() => parseMasterKey("not base64 !!")).toThrow();
    expect(() => parseMasterKey("")).toThrow();
  });
});
