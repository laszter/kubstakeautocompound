import type { Address, Hex } from "viem";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { positionSnapshots, positions, txs, validators, type DbExecutor } from "@kubstake/db";
import type { EngineStore } from "./engine";
import type { InFlightTx, TxStore } from "./txManager";

// Drizzle-backed implementations of the stores used by the tx state machine and the engine.

const IN_FLIGHT = ["signed", "broadcast"] as const;

export function createDbTxStore(db: DbExecutor): TxStore {
  return {
    async insertSigned(r) {
      const values = {
        walletId: r.walletId,
        positionId: r.positionId,
        actionId: r.actionId,
        kind: r.kind,
        status: "signed" as const,
        hash: r.hash,
        signedRaw: r.signedRaw,
        nonce: r.nonce,
        fromAddress: r.fromAddress,
        toAddress: r.toAddress,
        valueWei: r.valueWei,
        gasLimit: r.gasLimit,
        gasPriceWei: r.gasPriceWei,
      };
      // Deterministic signing: re-signing identical params with the same nonce yields the same hash. That can
      // only collide with an earlier row that never got mined ('failed'), which is then reused.
      const [row] = await db
        .insert(txs)
        .values(values)
        .onConflictDoUpdate({
          target: txs.hash,
          set: { status: "signed", error: null, positionId: r.positionId, actionId: r.actionId, broadcastAt: null },
          setWhere: eq(txs.status, "failed"),
        })
        .returning({ id: txs.id });
      if (!row) throw new Error(`insertSigned: tx ${r.hash} already exists and is not reusable`);
      return { id: row.id };
    },

    async markBroadcast(id, at) {
      await db
        .update(txs)
        .set({ status: "broadcast", broadcastAt: at })
        .where(and(eq(txs.id, id), eq(txs.status, "signed")));
    },

    async markConfirmed(id, f) {
      await db
        .update(txs)
        .set({
          status: f.status,
          gasUsed: f.gasUsed,
          blockNumber: f.blockNumber,
          eventDelegatedWei: f.events.delegatedWei,
          eventUndelegatedWei: f.events.undelegatedWei,
          eventClaimedWei: f.events.claimedWei,
          confirmedAt: f.at,
          error: f.error,
        })
        .where(eq(txs.id, id));
    },

    async markFailed(id, error) {
      await db
        .update(txs)
        .set({ status: "failed", error })
        .where(and(eq(txs.id, id), inArray(txs.status, IN_FLIGHT)));
    },

    async listInFlight(walletId) {
      const rows = await db
        .select({
          id: txs.id,
          walletId: txs.walletId,
          positionId: txs.positionId,
          actionId: txs.actionId,
          kind: txs.kind,
          status: txs.status,
          hash: txs.hash,
          signedRaw: txs.signedRaw,
          nonce: txs.nonce,
          fromAddress: txs.fromAddress,
          toAddress: txs.toAddress,
          valueWei: txs.valueWei,
          broadcastAt: txs.broadcastAt,
          createdAt: txs.createdAt,
        })
        .from(txs)
        .where(walletId ? and(inArray(txs.status, IN_FLIGHT), eq(txs.walletId, walletId)) : inArray(txs.status, IN_FLIGHT))
        .orderBy(asc(txs.createdAt));
      return rows.map(
        (r): InFlightTx => ({
          ...r,
          status: r.status as InFlightTx["status"],
          hash: r.hash as Hex,
          signedRaw: r.signedRaw as Hex,
          fromAddress: r.fromAddress as Address,
          toAddress: r.toAddress as Address,
        }),
      );
    },
  };
}

export function createDbEngineStore(db: DbExecutor): EngineStore {
  return {
    async updatePosition(id, patch) {
      if (Object.keys(patch).length === 0) return;
      await db.update(positions).set(patch).where(eq(positions.id, id));
    },
    async insertSnapshot(row) {
      await db.insert(positionSnapshots).values(row);
    },
    async hasTxSince(positionId, since) {
      const [row] = await db
        .select({ id: txs.id })
        .from(txs)
        .where(and(eq(txs.positionId, positionId), gt(txs.createdAt, since)))
        .limit(1);
      return row !== undefined;
    },
    async updateValidatorLive(validatorId, live) {
      await db
        .update(validators)
        .set({
          status: live.status,
          delegationEnabled: live.delegationEnabled,
          paused: live.paused,
          isOfficialPool: live.isOfficialPool,
          minDelegatedWei: live.minDelegatedWei,
        })
        .where(eq(validators.validatorId, validatorId));
    },
  };
}
