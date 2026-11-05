// Shared helpers for the mainnet-fork e2e scripts (setup.ts / assert.ts), driven by scripts/e2e-fork.sh.
// Everything here talks to the LOCAL anvil fork (127.0.0.1) and the throwaway e2e Postgres only.
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { CHAIN_ID, kubChain } from "@kubstake/core";

export const VALIDATOR_ID = 0;
/** ValidatorShare of validator id 0 (KUB) and its signer, as verified on mainnet (RECON §1). */
export const EXPECTED_SHARE = "0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20";
export const EXPECTED_SIGNER = "0x3c553ebe7ba890d87728ab7f38f579bc8104df25";

export const KUB = 10n ** 18n;
export const FUND_WEI = 1000n * KUB;
export const DELEGATE_WEI = 100n * KUB;
/** Injected via StakeManager.distributeReward from validator 0's signer (≈ 1.5 KUB for a 100 KUB delegator). */
export const REWARD_INJECTION_WEI = 100_000n * KUB;

/** From the verified StakeManagerV2 source (kubscan): onlyCoinbase → credits getValidatorId(msg.sender). */
export const stakeManagerRewardAbi = parseAbi([
  "function distributeReward() payable",
  "event DistributeRewards(uint256 indexed validatorId, uint256 totalReward, uint256 validatorReward, uint256 delegatorsReward, uint256 infraCommission, uint256 validatorCommission, uint256 delegatorCommission)",
]);

export type E2eConfig = { rpcUrl: string; databaseUrl: string; masterKey: string; stateFile: string };

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (run via: npm run e2e:fork)`);
  return v;
}

export function loadConfig(): E2eConfig {
  const rpcUrl = requireEnv("E2E_RPC_URL");
  const databaseUrl = requireEnv("E2E_DATABASE_URL");
  for (const [name, url] of [
    ["E2E_RPC_URL", rpcUrl],
    ["E2E_DATABASE_URL", databaseUrl],
  ] as const) {
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`refusing to run: ${name} must point at 127.0.0.1 (the local e2e stack), got host ${host}`);
    }
  }
  return { rpcUrl, databaseUrl, masterKey: requireEnv("E2E_MASTER_KEY"), stateFile: requireEnv("E2E_STATE_FILE") };
}

/** Raw JSON-RPC call (anvil_* / web3_* methods that viem does not type). */
export async function rpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result as T;
}

export type ForkInfo = { clientVersion: string; forkUrl: string | null; forkBlockNumber: number | null; hardfork: string | null };

/** Refuses to continue unless the RPC is an anvil node reporting chainId 96 (i.e. the local fork). */
export async function assertAnvilFork(rpcUrl: string): Promise<ForkInfo> {
  const clientVersion = await rpc<string>(rpcUrl, "web3_clientVersion");
  if (!/^anvil\//i.test(clientVersion)) {
    throw new Error(`refusing to run: ${rpcUrl} is not an anvil node (web3_clientVersion=${clientVersion})`);
  }
  const chainId = Number(await rpc<string>(rpcUrl, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`refusing to run: fork chainId ${chainId} != ${CHAIN_ID}`);
  const info = await rpc<{ hardFork?: string; forkConfig?: { forkUrl?: string; forkBlockNumber?: number } }>(
    rpcUrl,
    "anvil_nodeInfo",
  ).catch(() => null);
  return {
    clientVersion,
    forkUrl: info?.forkConfig?.forkUrl ?? null,
    forkBlockNumber: info?.forkConfig?.forkBlockNumber ?? null,
    hardfork: info?.hardFork ?? null,
  };
}

export function clients(rpcUrl: string) {
  const chain = kubChain(rpcUrl);
  const transport = http(rpcUrl, { timeout: 60_000, retryCount: 2 });
  return {
    pub: createPublicClient({ chain, transport }) as PublicClient,
    test: createTestClient({ chain, mode: "anvil", transport }),
    wallet: createWalletClient({ chain, transport }),
  };
}

// ---------------------------------------------------------------------------------------------
// state file (setup.ts writes, assert.ts reads) — bigint ↔ decimal string
// ---------------------------------------------------------------------------------------------
export type StepRecord = {
  step: string;
  actionId?: string;
  actionStatus?: string;
  actionError?: string | null;
  txHash?: string;
  txKind?: string;
  /** enqueue → action finished, ms */
  actionMs?: number;
  /** broadcast_at → confirmed_at of the tx row, ms */
  receiptMs?: number;
  note?: string;
};

export type E2eState = {
  startedAt: string;
  fork: ForkInfo;
  address: Address;
  walletId: string;
  positionId: string;
  share: Address;
  signer: Address;
  rewardInjections: { hash: Hex; delegatorsRewardWei: string; liquidAfterWei: string }[];
  steps: StepRecord[];
  /** set by setup.ts flow when every step ran */
  flowCompleted?: boolean;
};

export function writeState(file: string, s: E2eState): void {
  writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function readState(file: string): E2eState {
  return JSON.parse(readFileSync(file, "utf8")) as E2eState;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function fmtKub(wei: bigint | string | null | undefined, frac = 6): string {
  if (wei === null || wei === undefined) return "-";
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = `${a / KUB}.${(a % KUB).toString().padStart(18, "0").slice(0, frac)}`;
  return neg ? `-${s}` : s;
}
