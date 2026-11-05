// Test doubles for the worker: a fully mocked ChainIo (no RPC), in-memory TxStore / EngineStore and a
// local signer. Nothing here can reach a network — tests never broadcast anything.
import { vi, type Mock } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, type Address, type Hex, type Log } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import pino from "pino";
import { validatorShareAbi } from "@kubstake/core";
import type { PositionRow } from "@kubstake/db";
import type { ChainIo, ReceiptLite } from "../chainIo";
import type { EngineStore, PositionPatch } from "../engine";
import type { Logger } from "../logger";
import type { InFlightTx, SignedTxInput, TxFinal, TxSigner, TxStore } from "../txManager";

export const E18 = 10n ** 18n;
export const GWEI = 10n ** 9n;
export const kub = (n: number | string) => {
  const [i, f = ""] = String(n).split(".");
  return BigInt(i ?? "0") * E18 + BigInt((f + "0".repeat(18)).slice(0, 18));
};

/** validator id 0 (KUB official) share — only used as an address string; nothing is called on-chain. */
export const SHARE = getAddress("0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20");
/** Random throwaway key generated per test run — signs locally only, the chain is mocked. */
const TEST_ACCOUNT = privateKeyToAccount(generatePrivateKey());
export const TEST_ADDRESS: Address = TEST_ACCOUNT.address;

export function silentLogger(): Logger {
  return pino({ level: "silent" });
}

export function testSigner(): TxSigner & { signTransaction: Mock<TxSigner["signTransaction"]> } {
  return { address: TEST_ACCOUNT.address, signTransaction: vi.fn((tx) => TEST_ACCOUNT.signTransaction(tx)) };
}

export function receipt(status: "success" | "reverted", logs: Log[] = [], gasUsed = 207_000n): ReceiptLite {
  return { status, gasUsed, blockNumber: 36_800_000n, logs };
}

let logIndex = 0;
export function shareLog(
  eventName: "Delegated" | "Undelegated" | "ClaimedRewards",
  user: Address,
  amount: bigint,
  share: Address = SHARE,
): Log {
  const topics = encodeEventTopics({ abi: validatorShareAbi, eventName, args: { validatorId: 0n, user } });
  return {
    address: share,
    topics: topics as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockHash: `0x${"ab".repeat(32)}`,
    blockNumber: 36_800_000n,
    logIndex: logIndex++,
    transactionHash: `0x${"cd".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

export type MockChain = { [K in keyof ChainIo]: Mock<ChainIo[K]> };

/** Defaults: chainId 96, 25 gwei, nonce 7, 100 KUB liquid, 10,000 KUB principal, 11 KUB pending, validator open. */
export function mockChain(): MockChain {
  return {
    getChainId: vi.fn(async () => 96),
    getBlockNumber: vi.fn(async () => 36_800_000n),
    getGasPrice: vi.fn(async () => 25n * GWEI),
    getBalance: vi.fn(async () => kub(100)),
    getTransactionCount: vi.fn(async () => 7),
    readPositionState: vi.fn(async () => ({ principalWei: kub(10_000), pendingWei: kub(11) })),
    readShareFlags: vi.fn(async () => ({ delegationEnabled: true, paused: false, isOfficialPool: false, minDelegatedWei: kub(1) })),
    readValidatorStatus: vi.fn(async () => 1),
    estimateGas: vi.fn(async () => 207_000n),
    call: vi.fn(async () => {}),
    sendRawTransaction: vi.fn(async (raw: Hex) => keccak256(raw)),
    waitForTransactionReceipt: vi.fn(async () => receipt("success")),
    getTransactionReceipt: vi.fn(async () => null),
    getTransaction: vi.fn(async () => null),
    discoverValidators: vi.fn(async () => ({ validators: [], failedIds: [] })),
  };
}

export type MemRow = SignedTxInput & {
  id: string;
  status: "signed" | "broadcast" | "confirmed" | "reverted" | "failed";
  broadcastAt: Date | null;
  createdAt: Date;
  error: string | null;
  final?: TxFinal;
  history: string[];
};

export type MemoryTxStore = { [K in keyof TxStore]: Mock<TxStore[K]> } & {
  rows: Map<string, MemRow>;
  seed(row: Partial<MemRow> & Pick<MemRow, "status" | "nonce">): MemRow;
};

export function memoryTxStore(now: () => Date = () => new Date()): MemoryTxStore {
  const rows = new Map<string, MemRow>();
  let seq = 0;
  const toInFlight = (r: MemRow): InFlightTx => ({
    id: r.id,
    walletId: r.walletId,
    positionId: r.positionId,
    actionId: r.actionId,
    kind: r.kind,
    status: r.status as InFlightTx["status"],
    hash: r.hash,
    signedRaw: r.signedRaw,
    nonce: r.nonce,
    fromAddress: r.fromAddress,
    toAddress: r.toAddress,
    valueWei: r.valueWei,
    broadcastAt: r.broadcastAt,
    createdAt: r.createdAt,
  });
  const store: MemoryTxStore = {
    rows,
    insertSigned: vi.fn(async (input: SignedTxInput) => {
      const id = `tx-${++seq}`;
      rows.set(id, { ...input, id, status: "signed", broadcastAt: null, createdAt: now(), error: null, history: ["signed"] });
      return { id };
    }),
    markBroadcast: vi.fn(async (id: string, at: Date) => {
      const r = rows.get(id);
      if (r && r.status === "signed") Object.assign(r, { status: "broadcast", broadcastAt: at, history: [...r.history, "broadcast"] });
    }),
    markConfirmed: vi.fn(async (id: string, final: TxFinal) => {
      const r = rows.get(id);
      if (r) Object.assign(r, { status: final.status, final, error: final.error, history: [...r.history, final.status] });
    }),
    markFailed: vi.fn(async (id: string, error: string) => {
      const r = rows.get(id);
      if (r && (r.status === "signed" || r.status === "broadcast")) {
        Object.assign(r, { status: "failed", error, history: [...r.history, "failed"] });
      }
    }),
    listInFlight: vi.fn(async (walletId?: string) =>
      [...rows.values()]
        .filter((r) => (r.status === "signed" || r.status === "broadcast") && (!walletId || r.walletId === walletId))
        .map(toInFlight),
    ),
    seed(partial) {
      const id = partial.id ?? `tx-${++seq}`;
      const signedRaw = partial.signedRaw ?? (`0xf86b${id.replace(/\D/g, "").padStart(4, "0")}` as Hex);
      const row: MemRow = {
        walletId: "wallet-1",
        positionId: "position-1",
        actionId: null,
        kind: "compound_delegate",
        hash: keccak256(signedRaw),
        signedRaw,
        fromAddress: TEST_ACCOUNT.address,
        toAddress: SHARE,
        valueWei: kub(1),
        gasLimit: 260_000n,
        gasPriceWei: 25n * GWEI,
        broadcastAt: null,
        createdAt: now(),
        error: null,
        history: [partial.status],
        ...partial,
        id,
      };
      rows.set(id, row);
      return row;
    },
  };
  return store;
}

export type MemoryEngineStore = { [K in keyof EngineStore]: Mock<EngineStore[K]> } & {
  /** all patches for a position merged in call order */
  merged(positionId: string): PositionPatch;
};

export function memoryEngineStore(): MemoryEngineStore {
  const store = {
    updatePosition: vi.fn(async () => {}),
    insertSnapshot: vi.fn(async () => {}),
    hasTxSince: vi.fn(async () => false),
    updateValidatorLive: vi.fn(async () => {}),
  } as unknown as MemoryEngineStore;
  store.merged = (positionId: string) =>
    Object.assign(
      {},
      ...store.updatePosition.mock.calls.filter(([id]) => id === positionId).map(([, patch]) => patch),
    ) as PositionPatch;
  return store;
}

export function makePosition(overrides: Partial<PositionRow> = {}): PositionRow {
  const created = new Date("2026-10-01T00:00:00Z");
  return {
    id: "position-1",
    walletId: "wallet-1",
    validatorId: 0,
    enabled: true,
    strategy: "optimal",
    thresholdWei: null,
    cronExpr: null,
    minRewardWei: null,
    nextRunAt: null,
    principalWei: 0n,
    pendingWei: 0n,
    liquidWei: null,
    chainSyncedAt: null,
    aprEst: null,
    rStarWei: null,
    etaSec: null,
    nextCheckAt: created,
    lastCheckAt: null,
    lastCompoundAt: null,
    lastRunAt: null,
    lastRunResult: null,
    claimOnly: false,
    backoffLevel: 0,
    lastFailureAt: null,
    lastError: null,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}
