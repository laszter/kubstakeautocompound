import { describe, expect, it, vi } from "vitest";
import { ExecutionRevertedError } from "viem";
import { encodeClaim, encodeDelegate } from "@kubstake/core";
import type { PositionRow } from "@kubstake/db";
import {
  checkPosition,
  compoundNow,
  type EngineCtx,
  type EnginePosition,
  type EngineSettings,
  type EngineValidator,
} from "./engine";
import { TxManager } from "./txManager";
import {
  GWEI,
  SHARE,
  kub,
  makePosition,
  memoryEngineStore,
  memoryTxStore,
  mockChain,
  receipt,
  shareLog,
  silentLogger,
  testSigner,
} from "./test/fakes";

const NOW = new Date("2026-11-04T10:00:00Z"); // 17:00 Asia/Bangkok

const SETTINGS: EngineSettings = {
  gasReserveWei: kub("0.05"),
  maxGasPriceWei: 50n * GWEI,
  minIntervalSec: 3600,
  rFloorWei: kub("0.5"),
  checkMinSec: 900,
  checkMaxSec: 21_600,
};

function setup(opts: { dryRun?: boolean; position?: Partial<PositionRow>; validator?: Partial<EngineValidator> } = {}) {
  const dryRun = opts.dryRun ?? false;
  const chain = mockChain();
  const txStore = memoryTxStore(() => NOW);
  const store = memoryEngineStore();
  const signer = testSigner();
  const log = silentLogger();
  const txManager = new TxManager({ chain, store: txStore, dryRun, log, now: () => NOW });
  const accounts = { load: vi.fn(async () => signer) };
  const ctx: EngineCtx = {
    chain,
    txManager,
    store,
    accounts,
    log,
    config: { dryRun, subgraphUrl: "", timezone: "Asia/Bangkok", tickIntervalSec: 30 },
    now: () => NOW,
  };
  const ep: EnginePosition = {
    position: makePosition({ principalWei: kub(10_000), ...opts.position }),
    wallet: { id: "wallet-1", address: signer.address },
    validator: {
      validatorId: 0,
      shareAddress: SHARE.toLowerCase(),
      status: 1,
      delegationEnabled: true,
      paused: false,
      isOfficialPool: false,
      minDelegatedWei: kub(1),
      ...opts.validator,
    },
  };
  return { chain, txStore, store, signer, ctx, ep, accounts };
}

describe("checkPosition — optimal mode", () => {
  it("pending ≥ R* → 1-tx compound: delegate{value: pending}, records success", async () => {
    // P = 10,000 KUB @ 25 gwei: R* = √(2·0.00525·10000) ≈ 10.247 KUB < pending 11 KUB
    const { chain, txStore, store, signer, ctx, ep } = setup();
    chain.waitForTransactionReceipt.mockResolvedValue(
      receipt("success", [shareLog("ClaimedRewards", signer.address, kub(11)), shareLog("Delegated", signer.address, kub(11))]),
    );

    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(out.decision).toMatchObject({ action: "compound_1tx", reason: "ok", valueWei: kub(11) });
    expect(out.ran).toBe(true);
    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction.mock.calls[0]![0]).toMatchObject({
      type: "legacy",
      chainId: 96,
      to: SHARE,
      value: kub(11),
      data: encodeDelegate(),
    });
    // live flags + validator status re-read before signing
    expect(chain.readShareFlags.mock.invocationCallOrder[0]!).toBeLessThan(signer.signTransaction.mock.invocationCallOrder[0]!);
    expect(chain.readValidatorStatus).toHaveBeenCalledWith(0);
    expect([...txStore.rows.values()].map((r) => [r.kind, r.status])).toEqual([["compound_delegate", "confirmed"]]);

    const p = store.merged("position-1");
    expect(p).toMatchObject({
      principalWei: kub(10_000),
      pendingWei: kub(11),
      liquidWei: kub(100),
      claimOnly: false,
      lastCompoundAt: NOW,
      backoffLevel: 0,
      lastError: null,
      lastRunAt: NOW,
      lastRunResult: "compounded 1-tx 11 KUB",
    });
    expect(p.rStarWei! / 10n ** 15n).toBe(10_246n); // ≈ 10.247 KUB
    expect(store.insertSnapshot).toHaveBeenCalledTimes(1);
    expect(store.insertSnapshot.mock.calls[0]![0]).toMatchObject({ positionId: "position-1", pendingWei: kub(11), gasPriceWei: 25n * GWEI });
  });

  it("pending below R* → no tx, ETA-based next check (clamped to CHECK_MAX), no last_run_result", async () => {
    const { chain, signer, store, ctx, ep } = setup();
    chain.readPositionState.mockResolvedValue({ principalWei: kub(10_000), pendingWei: kub(5) });

    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(out.decision).toMatchObject({ action: "skip", reason: "below_threshold" });
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(chain.call).not.toHaveBeenCalled();
    const p = store.merged("position-1");
    expect(p.lastRunResult).toBeUndefined();
    expect(p.nextCheckAt).toEqual(new Date(NOW.getTime() + 21_600_000));
    expect(p.etaSec).toBeGreaterThan(2_800_000); // ~33 days to reach R* at 0.58%/yr
    expect(store.updatePosition).toHaveBeenCalledTimes(1);
  });

  it("liquid balance too small for 1-tx → 2-tx: claim, wait, delegate min(claimed, liquidNow − reserve − C)", async () => {
    // 2-tx R* = √(2·0.007525·10000) ≈ 12.27 KUB → pending 13 KUB
    const { chain, txStore, store, signer, ctx, ep } = setup();
    chain.readPositionState.mockResolvedValue({ principalWei: kub(10_000), pendingWei: kub(13) });
    chain.getBalance
      .mockResolvedValueOnce(kub("0.06")) // check: free = 0.01 KUB → no 1-tx float, enough for 2-tx gas
      .mockResolvedValueOnce(kub("0.06")) // claim tx balance check
      .mockResolvedValueOnce(kub("13.05")) // after claim
      .mockResolvedValueOnce(kub("13.05")); // delegate tx balance check
    chain.waitForTransactionReceipt
      .mockResolvedValueOnce(receipt("success", [shareLog("ClaimedRewards", signer.address, kub(13))], 110_000n))
      .mockResolvedValueOnce(receipt("success", [shareLog("Delegated", signer.address, kub("12.9934375"))]));

    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(out.decision.action).toBe("compound_2tx");
    const calls = signer.signTransaction.mock.calls.map(([tx]) => ({ data: tx.data, value: tx.value }));
    // budget = 13.05 − 0.05 reserve − 25 gwei × 262,500 = 12.9934375 KUB < claimed 13 KUB
    expect(calls).toEqual([
      { data: encodeClaim(), value: 0n },
      { data: encodeDelegate(), value: kub("12.9934375") },
    ]);
    expect([...txStore.rows.values()].map((r) => r.kind)).toEqual(["compound_claim", "compound_delegate"]);
    expect(store.merged("position-1")).toMatchObject({
      lastCompoundAt: NOW,
      backoffLevel: 0,
      lastRunResult: "compounded 2-tx 12.9934 KUB (claimed 13 KUB)",
    });
  });

  it("simulation revert → failed + backoff_level++, nothing signed", async () => {
    const { chain, txStore, store, signer, ctx, ep } = setup({ position: { backoffLevel: 1 } });
    chain.call.mockRejectedValue(new ExecutionRevertedError({ message: "execution reverted: ValidatorShare: paused" }));

    await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(txStore.rows.size).toBe(0);
    const p = store.merged("position-1");
    expect(p).toMatchObject({ backoffLevel: 2, lastFailureAt: NOW });
    expect(p.lastRunResult).toBe("failed: compound 1-tx 11 KUB: ValidatorShare: paused");
    // backoff level 2 → 60 min
    expect(p.nextCheckAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
  });

  it("DRY_RUN → simulated only: no signature, no txs row, no last_compound_at", async () => {
    const { chain, txStore, store, signer, ctx, ep } = setup({ dryRun: true });
    await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });
    expect(chain.estimateGas).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(chain.sendRawTransaction).not.toHaveBeenCalled();
    expect(txStore.rows.size).toBe(0);
    const p = store.merged("position-1");
    expect(p.lastRunResult).toBe("dry-run: would compound 1-tx 11 KUB (gas ≈ 207000)");
    expect(p.lastCompoundAt).toBeUndefined();
  });

  it("disabled position → state refreshed, never compounds", async () => {
    const { signer, store, ctx, ep } = setup({ position: { enabled: false } });
    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });
    expect(out.decision.action).toBe("compound_1tx");
    expect(out.ran).toBe(false);
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(store.merged("position-1")).toMatchObject({ pendingWei: kub(11), lastCheckAt: NOW });
    expect(store.merged("position-1").lastRunResult).toBeUndefined();
  });

  it("EWMA APR: sample between two checks without a tx in between", async () => {
    // 1 day at 0.58%/yr on 10,000 KUB ≈ 0.1589 KUB
    const accrued = (kub(10_000) * 58n) / 10_000n / 365n;
    const prev = { principalWei: kub(10_000), pendingWei: 0n, chainSyncedAt: new Date(NOW.getTime() - 86_400_000) };
    const a = setup({ position: prev });
    a.chain.readPositionState.mockResolvedValue({ principalWei: kub(10_000), pendingWei: accrued });
    await checkPosition(a.ctx, a.ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });
    expect(a.store.merged("position-1").aprEst).toBeCloseTo(0.0058, 6);

    const b = setup({ position: prev });
    b.chain.readPositionState.mockResolvedValue({ principalWei: kub(10_000), pendingWei: accrued });
    b.store.hasTxSince.mockResolvedValue(true); // a tx happened in between → no sample
    await checkPosition(b.ctx, b.ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });
    expect(b.store.merged("position-1").aprEst).toBeNull();
  });
});

describe("checkPosition — schedule mode", () => {
  const schedule = { strategy: "schedule" as const, cronExpr: "0 9 * * *" };
  const nextNineBangkok = new Date("2026-11-05T02:00:00Z");

  it("due + pending below min_reward (default 2 × C) → 'skipped: dust_reward' and next_run_at advances", async () => {
    const { chain, signer, store, ctx, ep } = setup({ position: { ...schedule, nextRunAt: new Date(NOW.getTime() - 60_000) } });
    chain.readPositionState.mockResolvedValue({ principalWei: kub(10_000), pendingWei: kub("0.001") });

    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(out.decision).toMatchObject({ action: "skip", reason: "dust_reward", thresholdWei: kub("0.0105") });
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(store.merged("position-1")).toMatchObject({
      lastRunResult: "skipped: dust_reward",
      lastRunAt: NOW,
      nextRunAt: nextNineBangkok,
    });
  });

  it("not due → no run, next_run_at untouched", async () => {
    const { signer, store, ctx, ep } = setup({ position: { ...schedule, nextRunAt: nextNineBangkok } });
    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });
    expect(out.decision.reason).toBe("not_due");
    expect(signer.signTransaction).not.toHaveBeenCalled();
    const p = store.merged("position-1");
    expect("nextRunAt" in p).toBe(false);
    expect(p.lastRunResult).toBeUndefined();
  });

  it("due with enough reward → compounds and advances next_run_at", async () => {
    const { signer, store, ctx, ep } = setup({ position: { ...schedule, nextRunAt: new Date(NOW.getTime() - 60_000) } });
    await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });
    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction.mock.calls[0]![0].value).toBe(kub(11));
    expect(store.merged("position-1")).toMatchObject({ nextRunAt: nextNineBangkok, lastCompoundAt: NOW });
  });
});

describe("checkPosition — claim-only", () => {
  it("validator delegation disabled → claimRewards() instead of delegate, claim_only flagged", async () => {
    const { chain, txStore, store, signer, ctx, ep } = setup({ validator: { delegationEnabled: false } });
    chain.readShareFlags.mockResolvedValue({ delegationEnabled: false, paused: false, isOfficialPool: false, minDelegatedWei: kub(1) });
    chain.waitForTransactionReceipt.mockResolvedValue(receipt("success", [shareLog("ClaimedRewards", signer.address, kub(11))], 110_000n));

    const out = await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(out.decision).toMatchObject({ action: "claim_only", claimOnly: true });
    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction.mock.calls[0]![0]).toMatchObject({ data: encodeClaim(), value: 0n, to: SHARE });
    expect([...txStore.rows.values()].map((r) => r.kind)).toEqual(["compound_claim"]);
    expect(store.merged("position-1")).toMatchObject({
      claimOnly: true,
      lastCompoundAt: NOW,
      lastRunResult: "claimed 11 KUB (claim-only: validator not accepting delegation)",
    });
  });

  it("DB says open but live flags say delegation disabled → switches to claim before signing", async () => {
    const { chain, signer, store, ctx, ep } = setup();
    chain.readShareFlags.mockResolvedValue({ delegationEnabled: false, paused: false, isOfficialPool: false, minDelegatedWei: kub(1) });

    await checkPosition(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI });

    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction.mock.calls[0]![0]).toMatchObject({ data: encodeClaim(), value: 0n });
    expect(store.updateValidatorLive).toHaveBeenCalledWith(0, expect.objectContaining({ delegationEnabled: false, status: 1 }));
  });
});

describe("compoundNow (manual action)", () => {
  it("bypasses threshold, MIN_INTERVAL and MAX_GAS_PRICE but still compounds through simulation", async () => {
    const { chain, signer, store, ctx, ep } = setup({ position: { lastCompoundAt: new Date(NOW.getTime() - 10 * 60_000) } });
    chain.readPositionState.mockResolvedValue({ principalWei: kub(10_000), pendingWei: kub(5) }); // below R*
    chain.getGasPrice.mockResolvedValue(60n * GWEI); // above MAX_GAS_PRICE 50

    const run = await compoundNow(ctx, ep, { settings: SETTINGS }, "action-1");

    expect(run.status).toBe("done");
    expect(chain.call).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction.mock.calls[0]![0]).toMatchObject({ value: kub(5), data: encodeDelegate(), gasPrice: 60n * GWEI });
    expect(store.merged("position-1").lastRunResult).toBe("manual: compounded 1-tx 5 KUB");
  });

  it("no principal → skipped with a readable reason, nothing signed", async () => {
    const { chain, signer, ctx, ep } = setup();
    chain.readPositionState.mockResolvedValue({ principalWei: 0n, pendingWei: 0n });
    const run = await compoundNow(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI }, "action-1");
    expect(run).toMatchObject({ status: "skipped", result: "skipped: no_principal" });
    expect(run.error).toMatch(/^no_principal/);
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });

  it("DRY_RUN → action error text 'DRY_RUN: simulated only (gas ≈ N)'", async () => {
    const { ctx, ep, signer } = setup({ dryRun: true });
    const run = await compoundNow(ctx, ep, { settings: SETTINGS, gasPriceWei: 25n * GWEI }, "action-1");
    expect(run).toMatchObject({ status: "dry_run", error: "DRY_RUN: simulated only (gas ≈ 207000)" });
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
});
