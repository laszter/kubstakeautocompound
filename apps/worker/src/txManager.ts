import { keccak256, type Address, type Hex } from "viem";
import { CHAIN_ID, decodeShareEvents, formatKub, gasLimitFor, type ShareEventSums, type TxKind } from "@kubstake/core";
import type { TxRowKind } from "@kubstake/db";
import type { ChainIo, ReceiptLite } from "./chainIo";
import {
  ChainIdMismatchError,
  SimulationError,
  WalletBusyError,
  errMsg,
  isDeterministicRejection,
  isTransientNetworkError,
  revertReason,
} from "./errors";
import type { Logger } from "./logger";

// Tx state machine (TASK §Worker tx state machine), one tx at a time for the whole process:
//   prepare (chainId 96, nonce 'pending', gasPrice, balance) → simulate (eth_call + estimateGas; revert → throw,
//   no row) → [DRY_RUN stops here] → sign legacy tx locally → INSERT txs status 'signed' (hash + raw)
//   → sendRawTransaction → 'broadcast' → wait receipt → 'confirmed' | 'reverted'.
// Anything unresolved (crash, timeout, network error) stays 'signed'/'broadcast' and recoverInFlight()
// finishes it: re-send the same raw tx (idempotent) or wait for its receipt — never re-sign.

export type LegacyTxRequest = {
  type: "legacy";
  chainId: number;
  nonce: number;
  gasPrice: bigint;
  gas: bigint;
  to: Address;
  value: bigint;
  data: Hex;
};

/** What the tx manager needs from an account: its address and local signing. */
export type TxSigner = {
  address: Address;
  signTransaction(tx: LegacyTxRequest): Promise<Hex>;
};

export type SignedTxInput = {
  walletId: string;
  positionId: string | null;
  actionId: string | null;
  kind: TxRowKind;
  hash: Hex;
  signedRaw: Hex;
  nonce: number;
  fromAddress: Address;
  toAddress: Address;
  valueWei: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
};

export type InFlightTx = {
  id: string;
  walletId: string;
  positionId: string | null;
  actionId: string | null;
  kind: TxRowKind;
  status: "signed" | "broadcast";
  hash: Hex;
  signedRaw: Hex;
  nonce: number;
  fromAddress: Address;
  toAddress: Address;
  valueWei: bigint;
  broadcastAt: Date | null;
  createdAt: Date;
};

export type TxFinal = {
  status: "confirmed" | "reverted";
  gasUsed: bigint;
  blockNumber: bigint;
  events: ShareEventSums;
  at: Date;
  error: string | null;
};

/** Persistence of the `txs` table, abstracted so the state machine can be tested without Postgres. */
export interface TxStore {
  /** Insert status 'signed' (hash + signed raw + nonce). Must complete before the tx is broadcast. */
  insertSigned(row: SignedTxInput): Promise<{ id: string }>;
  markBroadcast(id: string, at: Date): Promise<void>;
  /** Final on-chain outcome: 'confirmed' or 'reverted' (+ gas used, block, decoded share events). */
  markConfirmed(id: string, final: TxFinal): Promise<void>;
  /** Never mined: nonce consumed by another tx, dropped, or rejected by the node. */
  markFailed(id: string, error: string): Promise<void>;
  /** Rows in 'signed' or 'broadcast' (optionally for one wallet), oldest first. */
  listInFlight(walletId?: string): Promise<InFlightTx[]>;
}

export type ExecuteRequest = {
  walletId: string;
  positionId: string | null;
  actionId: string | null;
  kind: TxRowKind;
  to: Address;
  data: Hex;
  value: bigint;
  account: TxSigner;
};

export type DryRunResult = {
  dryRun: true;
  gasEstimate: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
  nonce: number;
};

export type SentTxResult =
  | {
      dryRun: false;
      status: "confirmed";
      txId: string;
      hash: Hex;
      events: ShareEventSums;
      gasUsed: bigint;
      blockNumber: bigint;
    }
  | { dryRun: false; status: "reverted"; txId: string; hash: Hex; error: string; gasUsed: bigint; blockNumber: bigint }
  | { dryRun: false; status: "failed"; txId: string; hash: Hex; error: string }
  /** Broadcast (or broadcast state unknown) but not settled yet — recoverInFlight() will finish it. */
  | { dryRun: false; status: "pending"; txId: string; hash: Hex };

export type TxResult = DryRunResult | SentTxResult;

export type SettledOutcome =
  | { status: "confirmed"; events: ShareEventSums; gasUsed: bigint; blockNumber: bigint }
  | { status: "reverted"; error: string }
  | { status: "failed"; error: string };

export type TxManagerOptions = {
  chain: ChainIo;
  store: TxStore;
  dryRun: boolean;
  log: Logger;
  now?: () => Date;
  receiptTimeoutMs?: number;
  pollingIntervalMs?: number;
  /** broadcast row with its nonce consumed by another tx and no receipt after this long → failed 'dropped' */
  droppedAfterMs?: number;
  /** Called by recoverInFlight() when a recovered tx reaches a final state (update action / position). */
  onSettled?: (tx: InFlightTx, outcome: SettledOutcome) => Promise<void>;
};

export type RecoverySummary = { checked: number; settled: number; resent: number };

const ZERO_EVENTS: ShareEventSums = { delegatedWei: 0n, undelegatedWei: 0n, claimedWei: 0n };

/** Gas-limit floor family of a txs.kind. */
export function baseTxKind(kind: TxRowKind): TxKind {
  switch (kind) {
    case "compound_delegate":
      return "delegate";
    case "compound_claim":
      return "claim";
    default:
      return kind;
  }
}

type BroadcastOutcome =
  | { kind: "broadcast" }
  | { kind: "settled"; final: TxFinal }
  | { kind: "failed"; error: string }
  | { kind: "unknown"; error: string };

export class TxManager {
  private readonly chain: ChainIo;
  private readonly store: TxStore;
  private readonly dryRun: boolean;
  private readonly log: Logger;
  private readonly now: () => Date;
  private readonly receiptTimeoutMs: number;
  private readonly pollingIntervalMs: number;
  private readonly droppedAfterMs: number;
  private readonly onSettled?: TxManagerOptions["onSettled"];

  constructor(opts: TxManagerOptions) {
    this.chain = opts.chain;
    this.store = opts.store;
    this.dryRun = opts.dryRun;
    this.log = opts.log;
    this.now = opts.now ?? (() => new Date());
    this.receiptTimeoutMs = opts.receiptTimeoutMs ?? 180_000;
    this.pollingIntervalMs = opts.pollingIntervalMs ?? 3000;
    this.droppedAfterMs = opts.droppedAfterMs ?? 10 * 60_000;
    this.onSettled = opts.onSettled;
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  /**
   * Prepare → simulate → (DRY_RUN: return estimate) → sign → persist 'signed' → broadcast → wait receipt.
   * Throws SimulationError (no row) when the tx would revert or cannot be paid for, WalletBusyError when
   * the wallet still has an unresolved tx, ChainIdMismatchError on a wrong RPC chain.
   */
  async execute(req: ExecuteRequest): Promise<TxResult> {
    const from = req.account.address;
    if (req.value < 0n) throw new Error("execute: value must be >= 0");

    const chainId = await this.chain.getChainId();
    if (chainId !== CHAIN_ID) throw new ChainIdMismatchError(CHAIN_ID, chainId);

    if ((await this.store.listInFlight(req.walletId)).length > 0) throw new WalletBusyError(req.walletId);

    // prepare
    const gasPriceWei = await this.chain.getGasPrice();
    const nonce = await this.chain.getTransactionCount(from, "pending");
    const balance = await this.chain.getBalance(from);

    // simulate (the exact same call that will be signed)
    const callReq = { from, to: req.to, data: req.data, value: req.value };
    let gasEstimate: bigint;
    try {
      await this.chain.call(callReq);
      gasEstimate = await this.chain.estimateGas(callReq);
    } catch (err) {
      if (isDeterministicRejection(err)) throw new SimulationError(revertReason(err), { cause: err });
      throw err;
    }
    const gasLimit = gasLimitFor(baseTxKind(req.kind), gasEstimate);
    const maxCost = req.value + gasLimit * gasPriceWei;
    if (balance < maxCost) {
      throw new SimulationError(
        `insufficient funds: balance ${formatKub(balance, 6)} KUB < value + max gas ${formatKub(maxCost, 6)} KUB`,
      );
    }

    if (this.dryRun) {
      this.log.info(
        { kind: req.kind, from, to: req.to, valueKub: formatKub(req.value, 6), gasEstimate: String(gasEstimate), nonce },
        "DRY_RUN: simulated only (nothing signed or sent)",
      );
      return { dryRun: true, gasEstimate, gasLimit, gasPriceWei, nonce };
    }

    // sign locally (legacy: KUB has no baseFee)
    const signedRaw = await req.account.signTransaction({
      type: "legacy",
      chainId: CHAIN_ID,
      nonce,
      gasPrice: gasPriceWei,
      gas: gasLimit,
      to: req.to,
      value: req.value,
      data: req.data,
    });
    const hash = keccak256(signedRaw);

    // persist BEFORE broadcast — if this throws, nothing has been sent
    const { id: txId } = await this.store.insertSigned({
      walletId: req.walletId,
      positionId: req.positionId,
      actionId: req.actionId,
      kind: req.kind,
      hash,
      signedRaw,
      nonce,
      fromAddress: from,
      toAddress: req.to,
      valueWei: req.value,
      gasLimit,
      gasPriceWei,
    });
    this.log.info({ txId, hash, kind: req.kind, nonce, valueKub: formatKub(req.value, 6) }, "tx signed and persisted");

    const sent = await this.broadcast(txId, signedRaw, hash, req.to, from);
    if (sent.kind === "failed") return { dryRun: false, status: "failed", txId, hash, error: sent.error };
    if (sent.kind === "unknown") return { dryRun: false, status: "pending", txId, hash };
    if (sent.kind === "settled") return this.toResult(txId, hash, sent.final);

    let receipt: ReceiptLite | null;
    try {
      receipt = await this.chain.waitForTransactionReceipt(hash, {
        timeoutMs: this.receiptTimeoutMs,
        pollingIntervalMs: this.pollingIntervalMs,
      });
    } catch (err) {
      this.log.warn({ txId, hash, err: errMsg(err) }, "waiting for receipt failed; recovery will continue");
      receipt = null;
    }
    if (!receipt) {
      this.log.warn({ txId, hash }, "tx not confirmed within timeout; recovery will keep tracking it");
      return { dryRun: false, status: "pending", txId, hash };
    }
    const final = await this.finalize(txId, receipt, req.to, from);
    return this.toResult(txId, hash, final);
  }

  /**
   * Run at start-up and at the start of every tick. 'signed' rows are re-sent (same raw tx) unless their
   * nonce was consumed by another tx; 'broadcast' rows are checked for a receipt, re-sent if the node lost
   * them, and failed as 'dropped' after `droppedAfterMs` when their nonce was used by something else.
   */
  async recoverInFlight(): Promise<RecoverySummary> {
    const rows = await this.store.listInFlight();
    const summary: RecoverySummary = { checked: rows.length, settled: 0, resent: 0 };
    for (const row of rows) {
      try {
        const r = await this.recoverOne(row);
        if (r === "settled") summary.settled++;
        if (r === "resent") summary.resent++;
      } catch (err) {
        this.log.warn({ txId: row.id, hash: row.hash, err: errMsg(err) }, "tx recovery step failed; will retry next tick");
      }
    }
    if (rows.length > 0) this.log.info(summary, "tx recovery pass");
    return summary;
  }

  private async recoverOne(row: InFlightTx): Promise<"settled" | "resent" | "waiting"> {
    // nonce first, then receipt: if the nonce is used but our receipt is missing, it really was another tx
    const latestNonce = await this.chain.getTransactionCount(row.fromAddress, "latest");
    const receipt = await this.chain.getTransactionReceipt(row.hash);
    if (receipt) {
      const final = await this.finalize(row.id, receipt, row.toAddress, row.fromAddress);
      await this.notify(row, finalToOutcome(final));
      return "settled";
    }
    const nonceUsed = latestNonce > row.nonce;

    if (row.status === "signed") {
      if (nonceUsed) return this.fail(row, "nonce_consumed");
      return this.resend(row);
    }

    // broadcast
    if (nonceUsed) {
      const ageMs = this.now().getTime() - (row.broadcastAt ?? row.createdAt).getTime();
      if (ageMs > this.droppedAfterMs) return this.fail(row, "dropped");
      return "waiting"; // receipt indexing may lag a little behind the nonce
    }
    const known = await this.chain.getTransaction(row.hash);
    if (!known) return this.resend(row);
    return "waiting";
  }

  private async resend(row: InFlightTx): Promise<"settled" | "resent" | "waiting"> {
    this.log.info({ txId: row.id, hash: row.hash, nonce: row.nonce }, "re-sending signed raw tx");
    const sent = await this.broadcast(row.id, row.signedRaw, row.hash, row.toAddress, row.fromAddress);
    switch (sent.kind) {
      case "broadcast":
        return "resent";
      case "settled":
        await this.notify(row, finalToOutcome(sent.final));
        return "settled";
      case "failed":
        await this.notify(row, { status: "failed", error: sent.error });
        return "settled";
      case "unknown":
        return "waiting";
    }
  }

  private async fail(row: InFlightTx, error: string): Promise<"settled"> {
    await this.store.markFailed(row.id, error);
    this.log.warn({ txId: row.id, hash: row.hash, nonce: row.nonce, error }, "tx marked failed");
    await this.notify(row, { status: "failed", error });
    return "settled";
  }

  private async notify(row: InFlightTx, outcome: SettledOutcome): Promise<void> {
    if (!this.onSettled) return;
    try {
      await this.onSettled(row, outcome);
    } catch (err) {
      this.log.warn({ txId: row.id, err: errMsg(err) }, "onSettled hook failed");
    }
  }

  /** sendRawTransaction + classification of its errors. Updates the row on definite outcomes. */
  private async broadcast(txId: string, signedRaw: Hex, hash: Hex, to: Address, from: Address): Promise<BroadcastOutcome> {
    try {
      await this.chain.sendRawTransaction(signedRaw);
      await this.safeMark(() => this.store.markBroadcast(txId, this.now()), txId);
      this.log.info({ txId, hash }, "tx broadcast");
      return { kind: "broadcast" };
    } catch (err) {
      const msg = errMsg(err);
      if (/already known|known transaction|already imported|already in pool/i.test(msg)) {
        await this.safeMark(() => this.store.markBroadcast(txId, this.now()), txId);
        return { kind: "broadcast" };
      }
      // Did it reach the node anyway?
      const known = await this.chain.getTransaction(hash).catch(() => null);
      if (known) {
        await this.safeMark(() => this.store.markBroadcast(txId, this.now()), txId);
        return { kind: "broadcast" };
      }
      if (/nonce too low/i.test(msg)) {
        // Either our own tx was just mined, or another tx took the nonce.
        const receipt = await this.chain.getTransactionReceipt(hash).catch(() => null);
        if (receipt) return { kind: "settled", final: await this.finalize(txId, receipt, to, from) };
        await this.store.markFailed(txId, "nonce_consumed");
        return { kind: "failed", error: "nonce_consumed" };
      }
      if (isTransientNetworkError(err)) {
        this.log.warn({ txId, hash, err: msg }, "broadcast outcome unknown (network); stays 'signed' for recovery");
        return { kind: "unknown", error: msg };
      }
      const error = `rejected by node: ${msg}`;
      await this.store.markFailed(txId, error);
      this.log.warn({ txId, hash, error }, "tx rejected by node");
      return { kind: "failed", error };
    }
  }

  private async finalize(txId: string, receipt: ReceiptLite, share: Address, user: Address): Promise<TxFinal> {
    const ok = receipt.status === "success";
    const final: TxFinal = {
      status: ok ? "confirmed" : "reverted",
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      events: ok ? decodeShareEvents(receipt.logs, share, user) : ZERO_EVENTS,
      at: this.now(),
      error: ok ? null : "reverted on-chain",
    };
    await this.safeMark(() => this.store.markConfirmed(txId, final), txId);
    this.log.info(
      { txId, status: final.status, gasUsed: String(final.gasUsed), block: String(final.blockNumber) },
      ok ? "tx confirmed" : "tx reverted on-chain",
    );
    return final;
  }

  /** DB writes after broadcast must not lose the tx: on failure the row stays in-flight and recovery fixes it. */
  private async safeMark(fn: () => Promise<void>, txId: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log.error({ txId, err: errMsg(err) }, "could not update txs row; recovery will reconcile it");
    }
  }

  private toResult(txId: string, hash: Hex, final: TxFinal): SentTxResult {
    if (final.status === "confirmed") {
      return {
        dryRun: false,
        status: "confirmed",
        txId,
        hash,
        events: final.events,
        gasUsed: final.gasUsed,
        blockNumber: final.blockNumber,
      };
    }
    return {
      dryRun: false,
      status: "reverted",
      txId,
      hash,
      error: final.error ?? "reverted on-chain",
      gasUsed: final.gasUsed,
      blockNumber: final.blockNumber,
    };
  }
}

function finalToOutcome(final: TxFinal): SettledOutcome {
  return final.status === "confirmed"
    ? { status: "confirmed", events: final.events, gasUsed: final.gasUsed, blockNumber: final.blockNumber }
    : { status: "reverted", error: final.error ?? "reverted on-chain" };
}
