import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { bitkub } from "viem/chains";
import { EXPLORER_URL_DEFAULT } from "./addresses";
import { CHAIN_ID } from "../env";

/** viem chain definition for KUB Mainnet with the RPC overridden (viem's built-in uses rpc.bitkubchain.io). */
export function kubChain(rpcUrl: string) {
  return defineChain({
    ...bitkub,
    id: CHAIN_ID,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: {
      default: { name: "KUB Scan", url: EXPLORER_URL_DEFAULT, apiUrl: `${EXPLORER_URL_DEFAULT}/api` },
    },
  });
}

/**
 * Read-oriented public client for KUB Mainnet. No multicall3 on this chain → no batching.
 * Pure factory: creating a client does not perform any network I/O.
 */
export function createKubPublicClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: kubChain(rpcUrl),
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 1000, timeout: 20_000 }),
  }) as PublicClient;
}

/** Throws unless the RPC reports chainId 96. Call before signing anything. */
export async function assertChainId(client: PublicClient): Promise<void> {
  const id = await client.getChainId();
  if (id !== CHAIN_ID) {
    throw new Error(`Wrong chain: expected chainId ${CHAIN_ID} (KUB Mainnet), RPC reported ${id}`);
  }
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export type LimiterOptions = {
  /** Backoff delays for rate-limit retries (default 2s, 4s, 8s → 3 retries). */
  retryDelaysMs?: readonly number[];
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True when an error (or any error in its `cause` chain) looks like an RPC rate limit:
 * JSON-RPC code -32005, HTTP 429, or a message mentioning "-32005" / "rate limit" / status 429.
 */
export function isRateLimitError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur != null; depth++) {
    if (typeof cur === "object") {
      const e = cur as { code?: unknown; status?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; cause?: unknown };
      if (e.code === -32005 || e.status === 429) return true;
      const text = [e.message, e.shortMessage, e.details].filter((v): v is string => typeof v === "string").join("\n");
      if (text.includes("-32005") || /rate\s*limit/i.test(text) || /\b429\b/.test(text)) return true;
      cur = e.cause;
    } else {
      const text = String(cur);
      return text.includes("-32005") || /rate\s*limit/i.test(text) || /\b429\b/.test(text);
    }
  }
  return false;
}

/**
 * Minimal p-limit: at most `concurrency` tasks run at once; tasks that fail with a rate-limit error
 * are retried inside their slot (holding it, which slows the whole queue down) after 2s, 4s, 8s.
 * Other errors are rethrown immediately.
 */
export function createLimiter(concurrency: number, opts: LimiterOptions = {}): Limiter {
  const max = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let active = 0;
  const queue: Array<() => void> = [];

  const pump = () => {
    while (active < max) {
      const job = queue.shift();
      if (!job) return;
      active++;
      job();
    }
  };

  const runWithRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const delay = delays[attempt];
        if (delay === undefined || !isRateLimitError(err)) throw err;
        await sleep(delay);
      }
    }
  };

  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        runWithRetry(fn)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
}

/** Pass-through limiter (no concurrency cap, no retry). */
export const unlimited: Limiter = (fn) => fn();
