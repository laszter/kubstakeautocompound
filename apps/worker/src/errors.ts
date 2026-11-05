import { BaseError, HttpRequestError, TimeoutError } from "viem";
import { isRateLimitError } from "@kubstake/core";

// Small error helpers shared by the worker. Messages end up in the DB (actions.error, positions.last_error)
// and in logs, so they are kept short, single-line and free of key material.

const MAX_LEN = 300;

function clip(s: string, max = MAX_LEN): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Short, single-line, human-readable error text (viem `shortMessage` preferred over its multi-line dump). */
export function errMsg(err: unknown, max = MAX_LEN): string {
  // drizzle wraps driver errors as "Failed query: <sql>" — the driver error (cause) is the useful part
  if (err instanceof Error && err.message.startsWith("Failed query:") && err.cause instanceof Error) {
    return errMsg(err.cause, max);
  }
  if (err instanceof BaseError) return clip(err.shortMessage || err.message.split("\n")[0] || err.name, max);
  if (err instanceof Error) return clip(err.message.split("\n")[0] || err.name, max);
  return clip(String(err), max);
}

/** The ExecutionRevertedError (or similar) inside a viem error chain, if any. */
function findRevert(err: unknown): BaseError | null {
  if (!(err instanceof BaseError)) return null;
  const found = err.walk((e) => e instanceof BaseError && (e.name === "ExecutionRevertedError" || e.name === "ContractFunctionRevertedError"));
  return found instanceof BaseError ? found : null;
}

/** True when the error is a deterministic on-chain rejection (revert / insufficient funds), not a network hiccup. */
export function isDeterministicRejection(err: unknown): boolean {
  if (findRevert(err)) return true;
  if (err instanceof BaseError) {
    const ins = err.walk((e) => e instanceof BaseError && e.name === "InsufficientFundsError");
    if (ins) return true;
  }
  const text = err instanceof Error ? err.message : String(err);
  return /execution reverted|insufficient funds/i.test(text);
}

/** Revert reason when present (e.g. "ValidatorShare: delegation is disabled"), otherwise `errMsg`. */
export function revertReason(err: unknown): string {
  const rev = findRevert(err);
  if (rev) {
    const fromDetails = /execution reverted:?\s*(.*)/i.exec(rev.details ?? "")?.[1]?.trim();
    if (fromDetails) return clip(fromDetails);
    const reason = (rev as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason) return clip(reason);
    const fromShort = /with reason:\s*(.*?)\.?$/.exec(rev.shortMessage)?.[1]?.trim();
    return clip(fromShort || rev.shortMessage);
  }
  if (err instanceof BaseError) {
    const ins = err.walk((e) => e instanceof BaseError && e.name === "InsufficientFundsError");
    if (ins instanceof BaseError) return clip(ins.shortMessage);
  }
  return errMsg(err);
}

/** Network-level failure (timeout, HTTP error, rate limit) where the outcome on the node is unknown. */
export function isTransientNetworkError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  if (err instanceof BaseError) {
    return err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError) !== null;
  }
  const text = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(text);
}

/** Pre-flight simulation (eth_call / estimateGas / balance check) rejected the tx. No `txs` row was created. */
export class SimulationError extends Error {
  readonly code = "SIMULATION_FAILED";
  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`simulation failed: ${reason}`, options);
    this.name = "SimulationError";
  }
}

/** The wallet still has an unresolved (signed/broadcast) tx; the worker sends one tx at a time. */
export class WalletBusyError extends Error {
  readonly code = "WALLET_BUSY";
  constructor(readonly walletId: string) {
    super(`wallet ${walletId} has a transaction in flight; waiting for it to settle`);
    this.name = "WalletBusyError";
  }
}

/** Decrypted private key does not derive the wallet's stored address. */
export class KeyAddressMismatchError extends Error {
  readonly code = "KEY_ADDRESS_MISMATCH";
  constructor(address: string) {
    super(`KEY_ADDRESS_MISMATCH: decrypted key does not match wallet ${address}`);
    this.name = "KeyAddressMismatchError";
  }
}

/** RPC reported a chain other than KUB Mainnet (96). Never sign in that case. */
export class ChainIdMismatchError extends Error {
  readonly code = "CHAIN_ID_MISMATCH";
  constructor(expected: number, actual: number) {
    super(`CHAIN_ID_MISMATCH: expected chainId ${expected}, RPC reported ${actual}`);
    this.name = "ChainIdMismatchError";
  }
}

/** Abortable sleep: resolves early (without throwing) when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
