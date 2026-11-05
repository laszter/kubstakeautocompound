import { describe, expect, it, vi } from "vitest";
import { ExecutionRevertedError, HttpRequestError, keccak256 } from "viem";
import { encodeClaim, encodeDelegate } from "@kubstake/core";
import { ChainIdMismatchError, SimulationError, WalletBusyError } from "./errors";
import { TxManager, type ExecuteRequest } from "./txManager";
import {
  E18,
  GWEI,
  SHARE,
  kub,
  memoryTxStore,
  mockChain,
  receipt,
  shareLog,
  silentLogger,
  testSigner,
} from "./test/fakes";

const NOW = new Date("2026-11-04T10:00:00Z");

function setup() {
  const chain = mockChain();
  const store = memoryTxStore(() => NOW);
  const signer = testSigner();
  const onSettled = vi.fn(async () => {});
  const tm = new TxManager({ chain, store, log: silentLogger(), now: () => NOW, onSettled });
  const req = (over: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
    walletId: "wallet-1",
    positionId: "position-1",
    actionId: null,
    kind: "compound_delegate",
    to: SHARE,
    data: encodeDelegate(),
    value: 3n * E18,
    account: signer,
    ...over,
  });
  return { chain, store, signer, tm, req, onSettled };
}

describe("TxManager.execute", () => {
  it("happy path: signed → broadcast → confirmed, row persisted BEFORE sendRawTransaction", async () => {
    const { chain, store, signer, tm, req } = setup();
    chain.waitForTransactionReceipt.mockResolvedValue(
      receipt("success", [shareLog("ClaimedRewards", signer.address, 3n * E18), shareLog("Delegated", signer.address, 3n * E18)]),
    );

    const r = await tm.execute(req());

    expect(r).toMatchObject({
      status: "confirmed",
      events: { delegatedWei: 3n * E18, claimedWei: 3n * E18, undelegatedWei: 0n },
      gasUsed: 207_000n,
    });
    const row = store.rows.get(r.txId)!;
    expect(row.history).toEqual(["signed", "broadcast", "confirmed"]);

    // persist-before-broadcast ordering
    const insertOrder = store.insertSigned.mock.invocationCallOrder[0]!;
    const sendOrder = chain.sendRawTransaction.mock.invocationCallOrder[0]!;
    const signOrder = signer.signTransaction.mock.invocationCallOrder[0]!;
    expect(signOrder).toBeLessThan(insertOrder);
    expect(insertOrder).toBeLessThan(sendOrder);

    // legacy tx, chainId 96, explicit pending nonce, gas-limit floor (207k × 1.25 = 258,750 < 260k floor)
    expect(chain.getTransactionCount).toHaveBeenCalledWith(signer.address, "pending");
    expect(signer.signTransaction).toHaveBeenCalledWith({
      type: "legacy",
      chainId: 96,
      nonce: 7,
      gasPrice: 25n * GWEI,
      gas: 260_000n,
      to: SHARE,
      value: 3n * E18,
      data: encodeDelegate(),
    });
    // the exact persisted raw is what gets broadcast; hash = keccak256(raw)
    const persisted = store.insertSigned.mock.calls[0]![0];
    expect(chain.sendRawTransaction).toHaveBeenCalledWith(persisted.signedRaw);
    expect(persisted.hash).toBe(keccak256(persisted.signedRaw));
    expect(persisted).toMatchObject({ nonce: 7, kind: "compound_delegate", valueWei: 3n * E18, gasLimit: 260_000n });
    // simulation ran on the same call before signing
    expect(chain.call).toHaveBeenCalledWith({ from: signer.address, to: SHARE, data: encodeDelegate(), value: 3n * E18 });
    expect(chain.call.mock.invocationCallOrder[0]!).toBeLessThan(signOrder);
  });

  it("uses estimate × 1.25 when it is above the floor", async () => {
    const { chain, signer, tm, req } = setup();
    chain.estimateGas.mockResolvedValue(300_000n);
    await tm.execute(req());
    expect(signer.signTransaction.mock.calls[0]![0].gas).toBe(375_000n);
  });

  it("revert in simulation → SimulationError with the reason, no txs row, nothing signed or sent", async () => {
    const { chain, store, signer, tm, req } = setup();
    chain.call.mockRejectedValue(new ExecutionRevertedError({ message: "execution reverted: ValidatorShare: delegation is disabled" }));

    const err = await tm.execute(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimulationError);
    expect((err as SimulationError).reason).toBe("ValidatorShare: delegation is disabled");
    expect(store.insertSigned).not.toHaveBeenCalled();
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(chain.sendRawTransaction).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it("insufficient balance for value + max gas → SimulationError before signing", async () => {
    const { chain, store, signer, tm, req } = setup();
    chain.getBalance.mockResolvedValue(3n * E18); // value 3 KUB + gas does not fit
    await expect(tm.execute(req())).rejects.toBeInstanceOf(SimulationError);
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(store.insertSigned).not.toHaveBeenCalled();
  });

  it("receipt status reverted → row 'reverted'", async () => {
    const { chain, store, tm, req } = setup();
    chain.waitForTransactionReceipt.mockResolvedValue(receipt("reverted", [], 150_000n));

    const r = await tm.execute(req({ kind: "claim", data: encodeClaim(), value: 0n }));
    expect(r).toMatchObject({ status: "reverted", gasUsed: 150_000n });
    expect(store.rows.get(r.txId)!.history).toEqual(["signed", "broadcast", "reverted"]);
    expect(store.markConfirmed).toHaveBeenCalledWith(r.txId, expect.objectContaining({ status: "reverted" }));
  });

  it("refuses to sign when the RPC is not chainId 96", async () => {
    const { chain, signer, store, tm, req } = setup();
    chain.getChainId.mockResolvedValue(1);
    await expect(tm.execute(req())).rejects.toBeInstanceOf(ChainIdMismatchError);
    expect(chain.call).not.toHaveBeenCalled();
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(store.insertSigned).not.toHaveBeenCalled();
  });

  it("one tx at a time: wallet with an in-flight tx → WalletBusyError", async () => {
    const { store, signer, tm, req } = setup();
    store.seed({ status: "broadcast", nonce: 6, broadcastAt: NOW });
    await expect(tm.execute(req())).rejects.toBeInstanceOf(WalletBusyError);
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });

  it("network error on broadcast → row stays 'signed', result pending (recovery re-sends later)", async () => {
    const { chain, store, tm, req } = setup();
    chain.sendRawTransaction.mockRejectedValue(new HttpRequestError({ url: "https://rpc.example", details: "socket hang up" }));
    const r = await tm.execute(req());
    expect(r).toMatchObject({ status: "pending" });
    expect(store.rows.get(r.txId)!.status).toBe("signed");
    expect(chain.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("node rejection on broadcast → row 'failed'", async () => {
    const { chain, store, tm, req } = setup();
    chain.sendRawTransaction.mockRejectedValue(new Error("insufficient funds for gas * price + value"));
    const r = await tm.execute(req());
    expect(r).toMatchObject({ status: "failed" });
    expect(store.rows.get(r.txId)!.history).toEqual(["signed", "failed"]);
  });

  it("receipt timeout → pending, row stays 'broadcast'", async () => {
    const { chain, store, tm, req } = setup();
    chain.waitForTransactionReceipt.mockResolvedValue(null);
    const r = await tm.execute(req());
    expect(r).toMatchObject({ status: "pending" });
    expect(store.rows.get(r.txId)!.status).toBe("broadcast");
  });
});

describe("TxManager.recoverInFlight", () => {
  it("'signed' row with unused nonce → re-sends the same raw tx (no re-sign) → 'broadcast'", async () => {
    const { chain, store, signer, tm } = setup();
    const row = store.seed({ status: "signed", nonce: 5 });
    chain.getTransactionCount.mockResolvedValue(5); // latest = 5 → nonce 5 not used yet

    const summary = await tm.recoverInFlight();

    expect(chain.getTransactionCount).toHaveBeenCalledWith(row.fromAddress, "latest");
    expect(chain.sendRawTransaction).toHaveBeenCalledWith(row.signedRaw);
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(store.rows.get(row.id)!.status).toBe("broadcast");
    expect(summary).toEqual({ checked: 1, settled: 0, resent: 1 });
  });

  it("'signed' row whose nonce was consumed by another tx → failed 'nonce_consumed'", async () => {
    const { chain, store, tm, onSettled } = setup();
    const row = store.seed({ status: "signed", nonce: 5 });
    chain.getTransactionCount.mockResolvedValue(6);
    await tm.recoverInFlight();
    expect(chain.sendRawTransaction).not.toHaveBeenCalled();
    expect(store.rows.get(row.id)).toMatchObject({ status: "failed", error: "nonce_consumed" });
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ id: row.id }), { status: "failed", error: "nonce_consumed" });
  });

  it("'signed' row that was actually mined (crash after send) → confirmed from its receipt", async () => {
    const { chain, store, tm, onSettled } = setup();
    const row = store.seed({ status: "signed", nonce: 5 });
    chain.getTransactionCount.mockResolvedValue(6);
    chain.getTransactionReceipt.mockResolvedValue(receipt("success", [shareLog("Delegated", row.fromAddress, kub(1))]));
    await tm.recoverInFlight();
    expect(chain.sendRawTransaction).not.toHaveBeenCalled();
    expect(store.rows.get(row.id)!.status).toBe("confirmed");
    expect(onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id }),
      expect.objectContaining({ status: "confirmed", events: { delegatedWei: kub(1), undelegatedWei: 0n, claimedWei: 0n } }),
    );
  });

  it("'broadcast' row, nonce consumed, no receipt after > 10 min → failed 'dropped'", async () => {
    const { chain, store, tm, onSettled } = setup();
    const row = store.seed({ status: "broadcast", nonce: 5, broadcastAt: new Date(NOW.getTime() - 11 * 60_000) });
    chain.getTransactionCount.mockResolvedValue(6);
    await tm.recoverInFlight();
    expect(store.rows.get(row.id)).toMatchObject({ status: "failed", error: "dropped" });
    expect(chain.sendRawTransaction).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ id: row.id }), { status: "failed", error: "dropped" });
  });

  it("'broadcast' row, nonce consumed but recent → keeps waiting", async () => {
    const { chain, store, tm } = setup();
    const row = store.seed({ status: "broadcast", nonce: 5, broadcastAt: new Date(NOW.getTime() - 2 * 60_000) });
    chain.getTransactionCount.mockResolvedValue(6);
    await tm.recoverInFlight();
    expect(store.rows.get(row.id)!.status).toBe("broadcast");
  });

  it("'broadcast' row unknown to the node with unused nonce → re-sends raw", async () => {
    const { chain, store, tm } = setup();
    const row = store.seed({ status: "broadcast", nonce: 5, broadcastAt: new Date(NOW.getTime() - 60_000) });
    chain.getTransactionCount.mockResolvedValue(5);
    chain.getTransaction.mockResolvedValue(null);
    await tm.recoverInFlight();
    expect(chain.sendRawTransaction).toHaveBeenCalledWith(row.signedRaw);
    expect(store.rows.get(row.id)!.status).toBe("broadcast");
  });

  it("'broadcast' row with a receipt → confirmed", async () => {
    const { chain, store, tm } = setup();
    const row = store.seed({ status: "broadcast", nonce: 5, broadcastAt: NOW });
    chain.getTransactionReceipt.mockResolvedValue(receipt("success"));
    const summary = await tm.recoverInFlight();
    expect(store.rows.get(row.id)!.status).toBe("confirmed");
    expect(summary.settled).toBe(1);
  });
});
