import { getAddress } from "viem";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  GAS_LIMIT_FLOOR,
  encodeClaim,
  encodeDelegate,
  encodeUndelegate,
  formatKub,
  gasCostWei,
} from "@kubstake/core";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { actions, positions, txs, type ActionRow, type DbExecutor } from "@kubstake/db";
import type { TickInputs, WorkerCtx } from "./context";
import { compoundNow, reasonText, type EnginePosition, type RunOutcome } from "./engine";
import { SimulationError, WalletBusyError, errMsg } from "./errors";
import type { Logger } from "./logger";
import { loadEnginePosition } from "./queries";
import type { InFlightTx, SettledOutcome, TxResult } from "./txManager";
import { syncValidators } from "./validatorSync";

// Action queue (TASK §Action lifecycle): the web app only INSERTs rows into `actions`; the worker picks
// them up here: pending → running → done | failed | skipped. A tx that is broadcast but not yet confirmed
// keeps its action 'running' until recoverInFlight() settles the tx (see createTxSettledHandler).
// Manual actions bypass MAX_GAS_PRICE and MIN_INTERVAL but keep the gas reserve, simulation and live flags.

export const MAX_ACTIONS_PER_TICK = 5;

type ActionOutcome =
  | { status: "done" | "failed" | "skipped"; error: string | null; txId?: string | null }
  /** tx broadcast, awaiting receipt — recovery finishes the action */
  | { status: "running"; txId: string }
  /** wallet busy with another tx — back to the queue */
  | { status: "pending" };

const clip = (s: string, max = 500) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Picks the oldest pending action (FOR UPDATE SKIP LOCKED) and marks it running. */
async function claimNextAction(db: DbExecutor, now: Date, exclude: string[]): Promise<ActionRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(actions)
      .where(exclude.length > 0 ? and(eq(actions.status, "pending"), notInArray(actions.id, exclude)) : eq(actions.status, "pending"))
      .orderBy(asc(actions.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx.update(actions).set({ status: "running", startedAt: now, error: null }).where(eq(actions.id, row.id));
    return { ...row, status: "running", startedAt: now };
  });
}

async function finishAction(db: DbExecutor, id: string, o: ActionOutcome, now: Date): Promise<void> {
  switch (o.status) {
    case "running":
      await db.update(actions).set({ txId: o.txId }).where(eq(actions.id, id));
      return;
    case "pending":
      await db.update(actions).set({ status: "pending", startedAt: null }).where(eq(actions.id, id));
      return;
    default:
      await db
        .update(actions)
        .set({ status: o.status, error: o.error === null ? null : clip(o.error), txId: o.txId ?? null, finishedAt: now })
        .where(eq(actions.id, id));
  }
}

/** Runs up to MAX_ACTIONS_PER_TICK queued actions, one at a time. */
export async function processActions(ctx: WorkerCtx, inputs: TickInputs, max = MAX_ACTIONS_PER_TICK): Promise<number> {
  const seen: string[] = [];
  let processed = 0;
  while (processed < max && !ctx.shouldStop()) {
    const action = await claimNextAction(ctx.db, ctx.now(), seen);
    if (!action) break;
    seen.push(action.id);
    processed++;
    ctx.log.info({ actionId: action.id, type: action.type, positionId: action.positionId }, "action started");
    let outcome: ActionOutcome;
    try {
      outcome = await runAction(ctx, action, inputs);
    } catch (err) {
      outcome = { status: "failed", error: errMsg(err) };
    }
    await finishAction(ctx.db, action.id, outcome, ctx.now());
    ctx.log.info(
      { actionId: action.id, type: action.type, status: outcome.status, error: "error" in outcome ? outcome.error : null },
      "action finished",
    );
  }
  return processed;
}

function fromTx(r: TxResult, label: string): ActionOutcome {
  switch (r.status) {
    case "confirmed":
      return { status: "done", error: null, txId: r.txId };
    case "reverted":
      return { status: "failed", error: `${label} reverted on-chain (${r.hash})`, txId: r.txId };
    case "failed":
      return { status: "failed", error: `${label}: ${r.error}`, txId: r.txId };
    case "pending":
      return { status: "running", txId: r.txId };
  }
}

function fromError(err: unknown, label: string): ActionOutcome {
  if (err instanceof WalletBusyError) return { status: "pending" };
  if (err instanceof SimulationError) return { status: "failed", error: `${label}: ${err.reason}` };
  return { status: "failed", error: `${label}: ${errMsg(err)}` };
}

function fromRun(run: RunOutcome): ActionOutcome {
  switch (run.status) {
    case "done":
      return { status: "done", error: null, txId: run.txId };
    case "pending":
      return run.txId ? { status: "running", txId: run.txId } : { status: "failed", error: run.result };
    case "failed":
      return { status: "failed", error: run.error ?? run.result, txId: run.txId };
    case "skipped":
      return run.busy ? { status: "pending" } : { status: "skipped", error: run.error ?? run.result };
  }
}

async function runAction(ctx: WorkerCtx, action: ActionRow, inputs: TickInputs): Promise<ActionOutcome> {
  if (action.type === "sync_validators") {
    await syncValidators(ctx, { throwOnError: true });
    return { status: "done", error: null };
  }
  if (!action.positionId) return { status: "failed", error: `${action.type} requires a position` };
  const ep = await loadEnginePosition(ctx.db, action.positionId);
  if (!ep) return { status: "failed", error: "position not found" };

  if (action.type === "compound") return fromRun(await compoundNow(ctx, ep, inputs, action.id));

  const outcome = await runTxAction(ctx, action, ep, inputs);
  // refresh principal/pending on the next tick after any manual tx attempt
  if (outcome.status !== "pending") {
    await ctx.store.updatePosition(ep.position.id, { nextCheckAt: ctx.now() });
  }
  return outcome;
}

async function runTxAction(ctx: WorkerCtx, action: ActionRow, ep: EnginePosition, inputs: TickInputs): Promise<ActionOutcome> {
  const share = getAddress(ep.validator.shareAddress);
  const user = getAddress(ep.wallet.address);
  const reserve = inputs.settings.gasReserveWei;

  const exec = async (kind: "delegate" | "undelegate" | "claim", data: `0x${string}`, value: bigint, label: string) => {
    try {
      const account = await ctx.accounts.load(ep.wallet.id);
      const r = await ctx.txManager.execute({
        walletId: ep.wallet.id,
        positionId: ep.position.id,
        actionId: action.id,
        kind,
        to: share,
        data,
        value,
        account,
      });
      return fromTx(r, label);
    } catch (err) {
      return fromError(err, label);
    }
  };

  switch (action.type) {
    case "delegate": {
      const amount = action.amountWei ?? 0n;
      if (amount <= 0n) return { status: "failed", error: "delegate: amount must be > 0" };
      // live flags + status — never trust the synced row for a tx
      const flags = await ctx.chain.readShareFlags(share);
      const status = await ctx.chain.readValidatorStatus(ep.validator.validatorId);
      await ctx.store.updateValidatorLive(ep.validator.validatorId, { status, ...flags }).catch(() => {});
      if (status !== 1 || !flags.delegationEnabled || flags.paused || flags.isOfficialPool) {
        return {
          status: "failed",
          error: "validator ไม่เปิดรับ delegate (delegation disabled / paused / official pool / inactive) — ยัง claim/undelegate ได้",
        };
      }
      const { principalWei } = await ctx.chain.readPositionState(share, user);
      const liquid = await ctx.chain.getBalance(user);
      const gasPrice = inputs.gasPriceWei ?? (await ctx.chain.getGasPrice());
      const cost = gasCostWei(gasPrice, GAS_LIMIT_FLOOR.delegate);
      if (liquid - reserve < amount + cost) {
        return {
          status: "failed",
          error: `ยอด KUB ไม่พอ: มี ${formatKub(liquid, 6)} KUB ต้องการ ${formatKub(amount + cost + reserve, 6)} KUB (จำนวน + gas + reserve ${formatKub(reserve)} KUB)`,
        };
      }
      if (principalWei + amount < flags.minDelegatedWei) {
        return {
          status: "failed",
          error: `ต้อง delegate รวมอย่างน้อย minDelegated ${formatKub(flags.minDelegatedWei)} KUB (ปัจจุบัน ${formatKub(principalWei)} KUB)`,
        };
      }
      return exec("delegate", encodeDelegate(), amount, `delegate ${formatKub(amount)} KUB`);
    }
    case "undelegate": {
      const amount = action.amountWei ?? 0n;
      if (amount <= 0n) return { status: "failed", error: "undelegate: amount must be > 0" };
      const { principalWei } = await ctx.chain.readPositionState(share, user);
      if (principalWei === 0n) return { status: "skipped", error: "ไม่มียอด stake ให้ถอน (principal = 0)" };
      if (amount > principalWei) {
        return {
          status: "failed",
          error: `จำนวนที่ถอน ${formatKub(amount)} KUB มากกว่ายอด stake ${formatKub(principalWei)} KUB`,
        };
      }
      return exec("undelegate", encodeUndelegate(amount), 0n, `undelegate ${formatKub(amount)} KUB`);
    }
    case "claim": {
      const { pendingWei } = await ctx.chain.readPositionState(share, user);
      if (pendingWei === 0n) return { status: "skipped", error: reasonText("zero_pending") };
      return exec("claim", encodeClaim(), 0n, `claim ${formatKub(pendingWei, 6)} KUB`);
    }
    default:
      return { status: "failed", error: `unknown action type ${action.type}` };
  }
}

/**
 * Actions left 'running' outside of processActions (previous leader crashed/killed, or a DB error while
 * finishing an action). Runs at the start of every tick, after tx recovery: an action with an in-flight
 * tx stays running (tx recovery settles it); otherwise it is closed from its last tx, or failed if no tx
 * was ever sent (safe: a tx is always persisted before it is broadcast).
 */
export async function recoverStaleActions(ctx: WorkerCtx): Promise<number> {
  const running = await ctx.db.select({ id: actions.id, type: actions.type }).from(actions).where(eq(actions.status, "running"));
  let closed = 0;
  for (const a of running) {
    const rows = await ctx.db
      .select({ id: txs.id, status: txs.status, error: txs.error, kind: txs.kind, hash: txs.hash })
      .from(txs)
      .where(eq(txs.actionId, a.id))
      .orderBy(desc(txs.createdAt));
    if (rows.some((t) => t.status === "signed" || t.status === "broadcast")) continue;
    const last = rows[0];
    const now = ctx.now();
    const outcome: ActionOutcome = !last
      ? { status: "failed", error: "action interrupted (worker restart / database error); no tx was sent — สั่งใหม่ได้" }
      : last.status === "confirmed"
        ? { status: "done", error: null, txId: last.id }
        : { status: "failed", error: `${last.kind}: ${last.error ?? last.status} (${last.hash})`, txId: last.id };
    await finishAction(ctx.db, a.id, outcome, now);
    closed++;
  }
  if (closed > 0) ctx.log.warn({ closed }, "closed actions left running by a previous worker");
  return closed;
}

/** TxManager.onSettled: a recovered tx reached a final state → finish its action and update its position. */
export function createTxSettledHandler(db: DbExecutor, log: Logger, now: () => Date = () => new Date()) {
  return async (tx: InFlightTx, outcome: SettledOutcome): Promise<void> => {
    const at = now();
    if (tx.actionId) {
      await db
        .update(actions)
        .set(
          outcome.status === "confirmed"
            ? { status: "done", error: null, txId: tx.id, finishedAt: at }
            : { status: "failed", error: clip(`${tx.kind}: ${outcome.error} (${tx.hash})`), txId: tx.id, finishedAt: at },
        )
        .where(and(eq(actions.id, tx.actionId), eq(actions.status, "running")));
    }
    if (tx.positionId) {
      const patch: PgUpdateSetSource<typeof positions> = { nextCheckAt: at };
      const isCompound = tx.kind === "compound_delegate" || tx.kind === "compound_claim";
      if (isCompound && outcome.status === "confirmed") {
        Object.assign(patch, {
          lastCompoundAt: at,
          backoffLevel: 0,
          lastError: null,
          lastFailureAt: null,
          lastRunAt: at,
          lastRunResult:
            tx.kind === "compound_delegate"
              ? `compounded ${formatKub(outcome.events.delegatedWei)} KUB (confirmed after recovery)`
              : `claimed ${formatKub(outcome.events.claimedWei)} KUB (confirmed after recovery)`,
        });
      } else if (isCompound) {
        const msg = `${tx.kind}: ${outcome.status === "failed" || outcome.status === "reverted" ? outcome.error : ""} (${tx.hash})`;
        Object.assign(patch, {
          backoffLevel: sql`${positions.backoffLevel} + 1`,
          lastFailureAt: at,
          lastError: clip(msg),
          lastRunAt: at,
          lastRunResult: clip(`failed: ${msg}`),
        });
      }
      await db.update(positions).set(patch).where(eq(positions.id, tx.positionId));
    }
    log.info({ txId: tx.id, actionId: tx.actionId, positionId: tx.positionId, status: outcome.status }, "recovered tx settled");
  };
}
