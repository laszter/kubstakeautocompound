import { LimitExceededRpcError, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import { assertChainId, createKubPublicClient, createLimiter, isRateLimitError } from "./client";

const noSleep = { sleep: vi.fn(async () => {}) };

describe("createLimiter", () => {
  it("caps concurrency and preserves results", async () => {
    const limit = createLimiter(2);
    let inFlight = 0;
    let max = 0;
    const task = (v: number) => async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return v * 2;
    };
    const out = await Promise.all([1, 2, 3, 4, 5, 6].map((v) => limit(task(v))));
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(max).toBe(2);
  });

  it("retries rate-limit errors with 2s/4s/8s backoff then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const limit = createLimiter(1, { sleep });
    let n = 0;
    const res = await limit(async () => {
      if (n++ < 3) throw new Error("RPC Request failed. Details: Rate limit exceeded (code -32005)");
      return "ok";
    });
    expect(res).toBe("ok");
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 4000, 8000]);
  });

  it("gives up after 3 retries", async () => {
    const limit = createLimiter(1, noSleep);
    const fn = vi.fn(async () => {
      throw new LimitExceededRpcError(new Error("limit"));
    });
    await expect(limit(fn)).rejects.toBeInstanceOf(LimitExceededRpcError);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not retry other errors", async () => {
    const limit = createLimiter(1, noSleep);
    const fn = vi.fn(async () => {
      throw new Error("execution reverted: ValidatorShare: delegation is disabled");
    });
    await expect(limit(fn)).rejects.toThrow(/delegation is disabled/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a failed task frees its slot", async () => {
    const limit = createLimiter(1, noSleep);
    await expect(limit(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await limit(async () => 1)).toBe(1);
  });
});

describe("isRateLimitError", () => {
  it("detects -32005, HTTP 429 and 'rate limit' text, including via cause", () => {
    expect(isRateLimitError({ code: -32005 })).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error("HTTP request failed. Status: 429"))).toBe(true);
    expect(isRateLimitError(new Error("outer", { cause: new Error("Rate limit exceeded") }))).toBe(true);
    expect(isRateLimitError(new LimitExceededRpcError(new Error("x")))).toBe(true);
  });

  it("ignores unrelated errors (incl. 429 inside hex)", () => {
    expect(isRateLimitError(new Error("execution reverted"))).toBe(false);
    expect(isRateLimitError(new Error("to: 0xab429cd"))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe("client helpers", () => {
  it("createKubPublicClient configures chain 96 with the given RPC (no I/O)", () => {
    const c = createKubPublicClient("https://rpc.example");
    expect(c.chain?.id).toBe(96);
    expect(c.chain?.rpcUrls.default.http).toEqual(["https://rpc.example"]);
  });

  it("assertChainId", async () => {
    await expect(assertChainId({ getChainId: async () => 96 } as unknown as PublicClient)).resolves.toBeUndefined();
    await expect(assertChainId({ getChainId: async () => 25925 } as unknown as PublicClient)).rejects.toThrow(/96/);
  });
});
