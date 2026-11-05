import { getAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADDRESSES } from "./addresses";
import { readPositionState } from "./position";
import { discoverValidators, fetchSubgraphProfiles, readShareFlags } from "./validators";

const E18 = 10n ** 18n;
const SHARE_0 = getAddress("0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20");
const SHARE_3 = getAddress("0x18dcc6ea272db3efc6e2c637cae5cd5534be6b1e");
const SHARE_4 = getAddress("0x1da3d9b03a6efd3d0b132dd6bdbe494bdb86e298");
const SHARE_1 = getAddress("0x488023dff3f0b063e4c0c2d939d9a10b1aba72e7");
const SIGNER = getAddress("0x00000000000000000000000000000000000000aa");
const USER = getAddress("0x1111111111111111111111111111111111111111");

type Call = { address: Address; functionName: string; args?: readonly unknown[] };

function info(share: Address, status: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    amount: 1_000n * E18,
    delegatedAmount: 5_000_000n * E18,
    reward: 0n,
    delegatorsReward: 0n,
    infraCommissionAmount: 0n,
    validatorCommissionAmount: 0n,
    delegatorCommissionAmount: 0n,
    minDeposit: 0n,
    signer: SIGNER,
    validatorShareContract: share,
    status,
    infraCommissionRate: 100,
    commissionRate: 500,
    ...over,
  };
}

type ShareState = { delegation: boolean; paused: boolean; isOfficialPool: boolean; minDelegated: bigint; totalSupply: bigint; fail?: boolean };

/** Fake chain: id0 active ✓, id1 unstaked (status 2), id2 active but no share, id3 active delegation=false, id4 share reads fail. */
function fakeChain(opts: { delayMs?: number; failInfo?: boolean } = {}) {
  const validators = [
    info(SHARE_0, 1, { commissionRate: 500 }),
    info(SHARE_1, 2),
    info(zeroAddress, 1),
    info(SHARE_3, 1, { commissionRate: 400, infraCommissionRate: 50, amount: 7n * E18 }),
    info(SHARE_4, 1),
  ];
  const shares: Record<string, ShareState> = {
    [SHARE_0.toLowerCase()]: { delegation: true, paused: false, isOfficialPool: false, minDelegated: E18, totalSupply: 5_668_489n * E18 },
    [SHARE_1.toLowerCase()]: { delegation: false, paused: false, isOfficialPool: false, minDelegated: 10n * E18, totalSupply: 1n },
    [SHARE_3.toLowerCase()]: { delegation: false, paused: true, isOfficialPool: false, minDelegated: 10n * E18, totalSupply: 42n * E18 },
    [SHARE_4.toLowerCase()]: { delegation: true, paused: false, isOfficialPool: false, minDelegated: 10n * E18, totalSupply: 1n, fail: true },
  };
  let inFlight = 0;
  let maxInFlight = 0;
  const readContract = vi.fn(async ({ address, functionName, args }: Call) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (address.toLowerCase() === ADDRESSES.stakeManagerStorage.toLowerCase()) {
        if (functionName === "getValidatorListLength") return BigInt(validators.length);
        if (functionName === "getValidatorInfoByIndex") {
          if (opts.failInfo) throw new Error("execution reverted");
          const v = validators[Number(args?.[0])];
          if (!v) throw new Error("index out of range");
          return v;
        }
        if (functionName === "isInMinimalValidatorListByValidatorId") return Number(args?.[0]) === 0;
      }
      const s = shares[address.toLowerCase()];
      if (s) {
        if (s.fail) throw new Error("boom");
        if (functionName === "delegation") return s.delegation;
        if (functionName === "paused") return s.paused;
        if (functionName === "isOfficialPool") return s.isOfficialPool;
        if (functionName === "minDelegated") return s.minDelegated;
        if (functionName === "totalSupply") return s.totalSupply;
        if (functionName === "balanceOf") return 123n * E18;
        if (functionName === "getLiquidRewards") return 4n * E18;
      }
      throw new Error(`unexpected call ${address}.${functionName}`);
    } finally {
      inFlight--;
    }
  });
  return { client: { readContract } as unknown as PublicClient, readContract, maxInFlight: () => maxInFlight };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverValidators", () => {
  it("keeps only status==1 with a share contract, maps fields, sorts by id, skips failing shares", async () => {
    const { client } = fakeChain();
    const logs: string[] = [];
    const rows = await discoverValidators(client, { log: (m) => logs.push(m) });
    expect(rows.map((r) => r.validatorId)).toEqual([0, 3]);

    const [v0, v3] = rows;
    expect(v0).toEqual({
      validatorId: 0,
      shareAddress: SHARE_0.toLowerCase(),
      signer: SIGNER,
      status: 1,
      commissionBps: 500,
      infraCommissionBps: 100,
      selfStakeWei: 1_000n * E18,
      delegatedWei: 5_000_000n * E18,
      minDelegatedWei: E18,
      delegationEnabled: true,
      paused: false,
      isOfficialPool: false,
      inMinimalSet: true,
      totalSupplyWei: 5_668_489n * E18,
    });
    expect(v3).toMatchObject({
      validatorId: 3,
      shareAddress: SHARE_3.toLowerCase(),
      commissionBps: 400,
      infraCommissionBps: 50,
      selfStakeWei: 7n * E18,
      delegationEnabled: false,
      paused: true,
      inMinimalSet: false,
      minDelegatedWei: 10n * E18,
    });
    expect(logs.some((l) => l.includes("#4") && l.includes("failed"))).toBe(true);
  });

  it("never calls write functions and never touches the subgraph without a URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { client, readContract } = fakeChain();
    await discoverValidators(client);
    expect(fetchSpy).not.toHaveBeenCalled();
    const fns = new Set(readContract.mock.calls.map(([c]) => c.functionName));
    for (const w of ["delegate", "undelegate", "claimRewards"]) expect(fns.has(w)).toBe(false);
    // unstaked (id 1) and zero-share (id 2) validators get no share reads
    expect(readContract.mock.calls.some(([c]) => c.address.toLowerCase() === SHARE_1.toLowerCase())).toBe(false);
  });

  it("respects the concurrency limit", async () => {
    const { client, maxInFlight } = fakeChain({ delayMs: 5 });
    await discoverValidators(client, { concurrency: 2 });
    expect(maxInFlight()).toBeLessThanOrEqual(2);
    expect(maxInFlight()).toBeGreaterThan(0);
  });

  it("merges subgraph names when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            validators: [
              { validatorId: "0", profile: { name: " KUB ", image: "https://static.example/kub.png" } },
              { validatorId: "3", profile: { name: "Bitkub Blockchain Technology", image: "javascript:alert(1)" } },
              { validatorId: "4", profile: null },
            ],
          },
        }),
      ),
    );
    const { client } = fakeChain();
    const rows = await discoverValidators(client, { subgraphUrl: "https://subgraph.example/pos" });
    expect(rows[0]).toMatchObject({ validatorId: 0, name: "KUB", imageUrl: "https://static.example/kub.png" });
    expect(rows[1]).toMatchObject({ validatorId: 3, name: "Bitkub Blockchain Technology" });
    expect(rows[1]?.imageUrl).toBeUndefined();
  });

  it("still works when the subgraph is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const { client } = fakeChain();
    const rows = await discoverValidators(client, { subgraphUrl: "https://subgraph.example/pos" });
    expect(rows.map((r) => r.validatorId)).toEqual([0, 3]);
    expect(rows[0]?.name).toBeUndefined();
  });

  it("throws when every validator info read fails", async () => {
    const { client } = fakeChain({ failInfo: true });
    await expect(discoverValidators(client)).rejects.toThrow(/every getValidatorInfoByIndex/);
  });
});

describe("fetchSubgraphProfiles", () => {
  it("returns an empty Map on HTTP errors, bad shapes and timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    expect((await fetchSubgraphProfiles("https://s.example")).size).toBe(0);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ errors: [{ message: "bad" }] })));
    expect((await fetchSubgraphProfiles("https://s.example")).size).toBe(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    expect((await fetchSubgraphProfiles("https://s.example", 20)).size).toBe(0);

    expect((await fetchSubgraphProfiles("")).size).toBe(0);
  });

  it("parses ids and names", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { validators: [{ validatorId: "22", profile: { name: "DaddyKim" } }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const m = await fetchSubgraphProfiles("https://s.example");
    expect(m.get(22)).toEqual({ name: "DaddyKim" });
    expect(fetchMock).toHaveBeenCalledWith("https://s.example", expect.objectContaining({ method: "POST" }));
  });
});

describe("readShareFlags / readPositionState", () => {
  it("reads live share flags", async () => {
    const { client } = fakeChain();
    expect(await readShareFlags(client, SHARE_3)).toEqual({
      delegationEnabled: false,
      paused: true,
      isOfficialPool: false,
      minDelegatedWei: 10n * E18,
    });
  });

  it("reads principal (balanceOf) and pending (getLiquidRewards) for the user", async () => {
    const { client, readContract } = fakeChain();
    expect(await readPositionState(client, SHARE_0, USER)).toEqual({ principalWei: 123n * E18, pendingWei: 4n * E18 });
    const calls = readContract.mock.calls.map(([c]) => c);
    expect(calls.find((c) => c.functionName === "balanceOf")?.args).toEqual([USER]);
    expect(calls.find((c) => c.functionName === "getLiquidRewards")?.args).toEqual([USER]);
  });
});
