import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import {
  ADDRESSES,
  discoverValidators,
  readPositionState,
  readShareFlags,
  stakeManagerStorageAbi,
  unlimited,
  type DiscoveredValidator,
  type Limiter,
  type ShareFlags,
} from "@kubstake/core";

// Every chain read/write the worker performs goes through this interface, so tests can mock the chain
// completely (no RPC, no real transactions).

export type CallRequest = { from: Address; to: Address; data: Hex; value: bigint };

export type ReceiptLite = {
  status: "success" | "reverted";
  gasUsed: bigint;
  blockNumber: bigint;
  logs: Log[];
};

export type TxLookup = { hash: Hex; nonce: number; blockNumber: bigint | null };

export type DiscoveryResult = {
  validators: DiscoveredValidator[];
  /** validator ids whose reads failed during this discovery (their DB rows must not be marked stale). */
  failedIds: number[];
};

export interface ChainIo {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getBalance(address: Address): Promise<bigint>;
  getTransactionCount(address: Address, blockTag: "pending" | "latest"): Promise<number>;
  readPositionState(share: Address, user: Address): Promise<{ principalWei: bigint; pendingWei: bigint }>;
  readShareFlags(share: Address): Promise<ShareFlags>;
  /** `status` of the validator struct in StakeManagerStorage (0 Uninit / 1 Active / 2 Unstaked). */
  readValidatorStatus(validatorId: number): Promise<number>;
  estimateGas(req: CallRequest): Promise<bigint>;
  /** eth_call simulation; throws (viem error with revert reason) if the call would revert. */
  call(req: CallRequest): Promise<void>;
  sendRawTransaction(signedRaw: Hex): Promise<Hex>;
  /** null on timeout. */
  waitForTransactionReceipt(hash: Hex, opts: { timeoutMs: number; pollingIntervalMs: number }): Promise<ReceiptLite | null>;
  /** null when the node does not know a receipt (not mined / unknown). */
  getTransactionReceipt(hash: Hex): Promise<ReceiptLite | null>;
  /** null when the node does not know the tx (not in mempool nor mined). */
  getTransaction(hash: Hex): Promise<TxLookup | null>;
  discoverValidators(): Promise<DiscoveryResult>;
}

export type ViemChainIoOptions = {
  /** shared RPC limiter (concurrency ≤ RPC_CONCURRENCY + retry on -32005) */
  limit?: Limiter;
  /** concurrency for validator discovery (it uses its own limiter) */
  discoveryConcurrency?: number;
  /** '' disables subgraph names */
  subgraphUrl?: string;
  log?: (msg: string) => void;
};

const FAILED_VALIDATOR = /^validator #(\d+)\b.*\bfailed\b/;

function toReceiptLite(r: { status: "success" | "reverted"; gasUsed: bigint; blockNumber: bigint; logs: Log[] }): ReceiptLite {
  return { status: r.status, gasUsed: r.gasUsed, blockNumber: r.blockNumber, logs: r.logs };
}

export function createViemChainIo(client: PublicClient, opts: ViemChainIoOptions = {}): ChainIo {
  const limit = opts.limit ?? unlimited;
  return {
    getChainId: () => limit(() => client.getChainId()),
    getBlockNumber: () => limit(() => client.getBlockNumber({ cacheTime: 0 })),
    getGasPrice: () => limit(() => client.getGasPrice()),
    getBalance: (address) => limit(() => client.getBalance({ address })),
    getTransactionCount: (address, blockTag) => limit(() => client.getTransactionCount({ address, blockTag })),
    readPositionState: (share, user) => readPositionState(client, share, user, limit),
    readShareFlags: (share) => readShareFlags(client, share, limit),
    readValidatorStatus: async (validatorId) => {
      const info = await limit(() =>
        client.readContract({
          address: ADDRESSES.stakeManagerStorage,
          abi: stakeManagerStorageAbi,
          functionName: "getValidatorInfoByIndex",
          args: [BigInt(validatorId)],
        }),
      );
      return Number(info.status);
    },
    estimateGas: (req) => limit(() => client.estimateGas({ account: req.from, to: req.to, data: req.data, value: req.value })),
    call: async (req) => {
      await limit(() => client.call({ account: req.from, to: req.to, data: req.data, value: req.value }));
    },
    // Re-sending the same raw tx is idempotent (same hash), so limiter retries on rate limits are safe.
    sendRawTransaction: (signedRaw) => limit(() => client.sendRawTransaction({ serializedTransaction: signedRaw })),
    // Not routed through the limiter: it would hold a slot for up to timeoutMs.
    waitForTransactionReceipt: async (hash, { timeoutMs, pollingIntervalMs }) => {
      try {
        const r = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: pollingIntervalMs });
        return toReceiptLite(r);
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) return null;
        throw err;
      }
    },
    getTransactionReceipt: async (hash) => {
      try {
        return toReceiptLite(await limit(() => client.getTransactionReceipt({ hash })));
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      }
    },
    getTransaction: async (hash) => {
      try {
        const tx = await limit(() => client.getTransaction({ hash }));
        return { hash: tx.hash, nonce: tx.nonce, blockNumber: tx.blockNumber };
      } catch (err) {
        if (err instanceof TransactionNotFoundError) return null;
        throw err;
      }
    },
    discoverValidators: async () => {
      const failed = new Set<number>();
      const validators = await discoverValidators(client, {
        concurrency: opts.discoveryConcurrency,
        subgraphUrl: opts.subgraphUrl || undefined,
        log: (m) => {
          const id = FAILED_VALIDATOR.exec(m)?.[1];
          if (id !== undefined) failed.add(Number(id));
          opts.log?.(m);
        },
      });
      return { validators, failedIds: [...failed] };
    },
  };
}
