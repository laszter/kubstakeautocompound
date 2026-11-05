import { zeroAddress, type Address, type PublicClient } from "viem";
import { z } from "zod";
import { stakeManagerStorageAbi, validatorShareAbi } from "./abis";
import { ADDRESSES } from "./addresses";
import { createLimiter, unlimited, type Limiter } from "./client";

export type DiscoveredValidator = {
  validatorId: number;
  /** ValidatorShare contract address, lowercase (matches the `validators.share_address` convention). */
  shareAddress: Address;
  signer: Address;
  status: number;
  commissionBps: number;
  infraCommissionBps: number;
  selfStakeWei: bigint;
  delegatedWei: bigint;
  minDelegatedWei: bigint;
  delegationEnabled: boolean;
  paused: boolean;
  isOfficialPool: boolean;
  inMinimalSet: boolean;
  totalSupplyWei: bigint;
  name?: string;
  imageUrl?: string;
};

export type ShareFlags = {
  delegationEnabled: boolean;
  paused: boolean;
  isOfficialPool: boolean;
  minDelegatedWei: bigint;
};

/** Live flags of a ValidatorShare. Re-check before every tx: the validator owner can change them at any time. */
export async function readShareFlags(client: PublicClient, share: Address, limit: Limiter = unlimited): Promise<ShareFlags> {
  const [delegationEnabled, paused, isOfficialPool, minDelegatedWei] = await Promise.all([
    limit(() => client.readContract({ address: share, abi: validatorShareAbi, functionName: "delegation" })),
    limit(() => client.readContract({ address: share, abi: validatorShareAbi, functionName: "paused" })),
    limit(() => client.readContract({ address: share, abi: validatorShareAbi, functionName: "isOfficialPool" })),
    limit(() => client.readContract({ address: share, abi: validatorShareAbi, functionName: "minDelegated" })),
  ]);
  return { delegationEnabled, paused, isOfficialPool, minDelegatedWei };
}

// The subgraph has introspection disabled; this query was verified against the live endpoint (2026-11-04).
// No `where:{isDelegation:true}` filter so active validators with delegation disabled still get names.
const PROFILE_QUERY = "{ validators(first: 1000) { validatorId profile { name image } } }";

const profileResponse = z.object({
  data: z.object({
    validators: z.array(
      z.object({
        validatorId: z.union([z.string(), z.number()]),
        profile: z
          .object({ name: z.string().nullish(), image: z.string().nullish() })
          .nullish(),
      }),
    ),
  }),
});

function cleanName(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  return t || undefined;
}

function cleanImageUrl(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort validator names/logos from the Bitkub subgraph. Any failure → empty Map (never throws). */
export async function fetchSubgraphProfiles(
  url: string,
  timeoutMs = 5000,
): Promise<Map<number, { name: string; imageUrl?: string }>> {
  const out = new Map<number, { name: string; imageUrl?: string }>();
  if (!url) return out;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: PROFILE_QUERY }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return out;
    const parsed = profileResponse.safeParse(await res.json());
    if (!parsed.success) return out;
    for (const v of parsed.data.data.validators) {
      const id = Number(v.validatorId);
      const name = cleanName(v.profile?.name);
      if (!Number.isSafeInteger(id) || id < 0 || !name) continue;
      const imageUrl = cleanImageUrl(v.profile?.image);
      out.set(id, imageUrl ? { name, imageUrl } : { name });
    }
    return out;
  } catch {
    return new Map();
  }
}

type ValidatorInfo = {
  amount: bigint;
  delegatedAmount: bigint;
  signer: Address;
  validatorShareContract: Address;
  status: number;
  infraCommissionRate: number;
  commissionRate: number;
};

const MAX_VALIDATORS = 10_000;

/**
 * Read-only validator discovery (RECON §1):
 * getValidatorListLength → getValidatorInfoByIndex(i) (index == validatorId) → keep status==1 && share!=0x0
 * → per share: delegation/paused/isOfficialPool/minDelegated/totalSupply + isInMinimalValidatorListByValidatorId
 * → optional subgraph names. All RPC reads go through one limiter (default concurrency 4, retry on -32005).
 * Returns validators sorted by validatorId. A validator whose reads fail is skipped (logged); throws only when
 * the list length cannot be read or every validator read failed.
 */
export async function discoverValidators(
  client: PublicClient,
  opts?: { concurrency?: number; subgraphUrl?: string; log?: (m: string) => void },
): Promise<DiscoveredValidator[]> {
  const limit = createLimiter(opts?.concurrency ?? 4);
  const log = opts?.log ?? (() => {});
  const storage = ADDRESSES.stakeManagerStorage;

  // Start the (independent, best-effort) subgraph request early.
  const profilesPromise = opts?.subgraphUrl ? fetchSubgraphProfiles(opts.subgraphUrl) : Promise.resolve(new Map());

  const lenRaw = await limit(() =>
    client.readContract({ address: storage, abi: stakeManagerStorageAbi, functionName: "getValidatorListLength" }),
  );
  const n = Number(lenRaw);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_VALIDATORS) {
    throw new Error(`discoverValidators: implausible validator list length ${String(lenRaw)}`);
  }

  let failures = 0;
  const infos = await Promise.all(
    Array.from({ length: n }, (_, id) =>
      limit(() =>
        client.readContract({
          address: storage,
          abi: stakeManagerStorageAbi,
          functionName: "getValidatorInfoByIndex",
          args: [BigInt(id)],
        }),
      ).then(
        (info) => ({ id, info: info as ValidatorInfo }),
        (err: unknown) => {
          failures++;
          log(`validator #${id}: getValidatorInfoByIndex failed: ${errMsg(err)}`);
          return null;
        },
      ),
    ),
  );
  if (n > 0 && failures === n) throw new Error("discoverValidators: every getValidatorInfoByIndex call failed");

  const active = infos.filter(
    (x): x is { id: number; info: ValidatorInfo } =>
      x !== null && Number(x.info.status) === 1 && x.info.validatorShareContract.toLowerCase() !== zeroAddress,
  );
  log(`validators: list length ${n}, active with share contract ${active.length}`);

  const rows = await Promise.all(
    active.map(async ({ id, info }): Promise<DiscoveredValidator | null> => {
      const share = info.validatorShareContract.toLowerCase() as Address;
      try {
        const [flags, totalSupplyWei, inMinimalSet] = await Promise.all([
          readShareFlags(client, share, limit),
          limit(() => client.readContract({ address: share, abi: validatorShareAbi, functionName: "totalSupply" })),
          limit(() =>
            client.readContract({
              address: storage,
              abi: stakeManagerStorageAbi,
              functionName: "isInMinimalValidatorListByValidatorId",
              args: [BigInt(id)],
            }),
          ),
        ]);
        return {
          validatorId: id,
          shareAddress: share,
          signer: info.signer,
          status: Number(info.status),
          commissionBps: Number(info.commissionRate),
          infraCommissionBps: Number(info.infraCommissionRate),
          selfStakeWei: info.amount,
          delegatedWei: info.delegatedAmount,
          minDelegatedWei: flags.minDelegatedWei,
          delegationEnabled: flags.delegationEnabled,
          paused: flags.paused,
          isOfficialPool: flags.isOfficialPool,
          inMinimalSet,
          totalSupplyWei,
        };
      } catch (err) {
        log(`validator #${id} (${share}): share reads failed: ${errMsg(err)}`);
        return null;
      }
    }),
  );

  const profiles = (await profilesPromise) as Map<number, { name: string; imageUrl?: string }>;
  if (opts?.subgraphUrl) log(`subgraph profiles: ${profiles.size}`);

  return rows
    .filter((r): r is DiscoveredValidator => r !== null)
    .map((r) => {
      const p = profiles.get(r.validatorId);
      if (!p) return r;
      return p.imageUrl ? { ...r, name: p.name, imageUrl: p.imageUrl } : { ...r, name: p.name };
    })
    .sort((a, b) => a.validatorId - b.validatorId);
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { shortMessage?: unknown; message?: unknown };
    if (typeof e.shortMessage === "string") return e.shortMessage;
    if (typeof e.message === "string") return e.message.split("\n")[0] ?? "";
  }
  return String(err);
}
