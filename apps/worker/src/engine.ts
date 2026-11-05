import { getAddress, type Hex } from "viem";
import {
  APR_DEFAULT,
  GAS_EST_1TX,
  aprSample,
  backoffDelayMs,
  decideCompound,
  encodeClaim,
  encodeDelegate,
  etaSeconds,
  formatKub,
  gasCostWei,
  gasLimitFor,
  nextCheckDelaySec,
  nextRunAt,
  updateEwma,
  type CompoundDecision,
  type CompoundInput,
  type DecisionReason,
  type ShareEventSums,
} from "@kubstake/core";
import type { NewPositionSnapshotRow, PositionRow, SettingsRow, TxRowKind, ValidatorRow } from "@kubstake/db";
import type { WorkerCtx } from "./context";
import {
  KeyAddressMismatchError,
  SimulationError,
  WalletBusyError,
  errMsg,
  isTransientNetworkError,
} from "./errors";
import type { TxResult, TxSigner } from "./txManager";

// Compound engine (TASK §Compound policy): read chain state → EWMA APR → decideCompound (pure, core) →
// persist state + snapshot → run the chosen path. Live share flags + validator status are re-read right
// before any tx is sent (the validator owner can flip them at any time; DB rows may be stale).

export type PositionPatch = Partial<Omit<PositionRow, "id" | "walletId" | "validatorId" | "createdAt" | "updatedAt">>;

export type LiveValidator = {
  status: number;
  delegationEnabled: boolean;
  paused: boolean;
  isOfficialPool: boolean;
  minDelegatedWei: bigint;
};

/** DB access needed by the engine (drizzle implementation in store.ts; in-memory fake in tests). */
export interface EngineStore {
  updatePosition(id: string, patch: PositionPatch): Promise<void>;
  insertSnapshot(row: NewPositionSnapshotRow): Promise<void>;
  /** Any txs row for this position created after `since` (APR samples only span checks without a tx). */
  hasTxSince(positionId: string, since: Date): Promise<boolean>;
  updateValidatorLive(validatorId: number, live: LiveValidator): Promise<void>;
}

export type EngineCtx = Pick<WorkerCtx, "chain" | "txManager" | "store" | "accounts" | "log" | "config" | "now">;

export type EngineValidator = Pick<
  ValidatorRow,
  "validatorId" | "shareAddress" | "status" | "delegationEnabled" | "paused" | "isOfficialPool" | "minDelegatedWei"
>;

export type EnginePosition = {
  position: PositionRow;
  wallet: { id: string; address: string };
  validator: EngineValidator;
};

export type EngineSettings = Pick<
  SettingsRow,
  "gasReserveWei" | "maxGasPriceWei" | "minIntervalSec" | "rFloorWei" | "checkMinSec" | "checkMaxSec"
>;

export type EngineInputs = { settings: EngineSettings; gasPriceWei?: bigint };

export type ChainState = { principalWei: bigint; pendingWei: bigint; liquidWei: bigint; gasPriceWei: bigint };

export type RunStatus = "done" | "failed" | "pending" | "skipped";

export type RunOutcome = {
  status: RunStatus;
  /** positions.last_run_result */
  result: string;
  /** backoff / last_compound_at / last_error / next_check_at */
  patch: PositionPatch;
  /** last txs row produced (actions.tx_id) */
  txId: string | null;
  /** short text for actions.error (null on success) */
  error: string | null;
  /** the wallet had an unresolved tx — try again later (manual actions go back to 'pending') */
  busy?: boolean;
};

export type CheckOutcome = { decision: CompoundDecision; ran: boolean; result: string | null; run?: RunOutcome };

/** pg `integer` max — positions.eta_sec stores NULL beyond this or for non-finite ETAs. */
const INT4_MAX = 2_147_483_647;
/** Sanity bound for one APR sample (100%/yr); anything above is a measurement artefact. */
const MAX_APR_SAMPLE = 1;
const MAX_WEI = 2n ** 255n;

/** Skip reasons worth recording in last_run_result when the trigger condition was otherwise met. */
const NOTABLE_SKIPS = new Set<DecisionReason>(["backoff", "min_interval", "gas_too_high", "insufficient_gas"]);

const REASON_TEXT: Partial<Record<DecisionReason, string>> = {
  no_principal: "ยังไม่มีเงิน stake ใน position นี้",
  zero_pending: "ไม่มี reward ค้าง",
  insufficient_gas: "KUB ในกระเป๋าไม่พอสำหรับค่า gas + reserve",
  below_threshold: "reward ยังไม่ถึงเกณฑ์",
  gas_too_high: "gas price สูงเกิน MAX_GAS_PRICE",
  min_interval: "ยังไม่ครบ MIN_INTERVAL นับจาก compound ล่าสุด",
  backoff: "อยู่ในช่วง backoff หลังล้มเหลว",
};

export function reasonText(reason: DecisionReason): string {
  const t = REASON_TEXT[reason];
  return t ? `${reason}: ${t}` : reason;
}

const addSec = (d: Date, sec: number) => new Date(d.getTime() + sec * 1000);

export function toEtaSec(eta: number): number | null {
  return Number.isFinite(eta) && eta >= 0 && eta <= INT4_MAX ? Math.round(eta) : null;
}

export async function readChainState(ctx: EngineCtx, ep: EnginePosition, gasPriceWei?: bigint): Promise<ChainState> {
  const share = getAddress(ep.validator.shareAddress);
  const user = getAddress(ep.wallet.address);
  const { principalWei, pendingWei } = await ctx.chain.readPositionState(share, user);
  const liquidWei = await ctx.chain.getBalance(user);
  const gp = gasPriceWei ?? (await ctx.chain.getGasPrice());
  return { principalWei, pendingWei, liquidWei, gasPriceWei: gp };
}

export function buildInput(
  ep: EnginePosition,
  s: ChainState,
  settings: EngineSettings,
  now: Date,
  scheduleDue: boolean,
): CompoundInput {
  const p = ep.position;
  return {
    strategy: p.strategy,
    thresholdWei: p.thresholdWei,
    scheduleDue,
    minRewardWei: p.minRewardWei,
    principalWei: s.principalWei,
    pendingWei: s.pendingWei,
    liquidWei: s.liquidWei,
    gasPriceWei: s.gasPriceWei,
    maxGasPriceWei: settings.maxGasPriceWei,
    gasReserveWei: settings.gasReserveWei,
    rFloorWei: settings.rFloorWei,
    minIntervalSec: settings.minIntervalSec,
    lastCompoundAt: p.lastCompoundAt,
    now,
    validatorActive: ep.validator.status === 1,
    delegationEnabled: ep.validator.delegationEnabled,
    paused: ep.validator.paused,
    isOfficialPool: ep.validator.isOfficialPool,
    backoffLevel: p.backoffLevel,
    lastFailureAt: p.lastFailureAt,
  };
}

/**
 * Manual "compound now": ignore mode/threshold, MIN_INTERVAL, MAX_GAS_PRICE and backoff — but keep the
 * gas reserve, path selection (1-tx/2-tx/claim-only), simulation and validator flags.
 */
export function forcedInput(i: CompoundInput): CompoundInput {
  return {
    ...i,
    strategy: "threshold",
    thresholdWei: 1n,
    scheduleDue: true,
    minIntervalSec: 0,
    lastCompoundAt: null,
    maxGasPriceWei: MAX_WEI,
    backoffLevel: 0,
    lastFailureAt: null,
  };
}

/** schedule mode: due when next_run_at <= now; `nextRunAt` = new value to store (undefined = unchanged). */
export function scheduleState(
  p: Pick<PositionRow, "strategy" | "cronExpr" | "nextRunAt">,
  timezone: string,
  now: Date,
): { due: boolean; nextRunAt: Date | null | undefined } {
  if (p.strategy !== "schedule" || !p.cronExpr) return { due: false, nextRunAt: undefined };
  if (!p.nextRunAt) return { due: false, nextRunAt: nextRunAt(p.cronExpr, timezone, now) };
  if (p.nextRunAt.getTime() <= now.getTime()) return { due: true, nextRunAt: nextRunAt(p.cronExpr, timezone, now) };
  return { due: false, nextRunAt: undefined };
}

async function estimateApr(ctx: EngineCtx, p: PositionRow, s: ChainState, now: Date): Promise<number | null> {
  const prevAt = p.chainSyncedAt;
  if (!prevAt || p.principalWei !== s.principalWei) return p.aprEst;
  const sample = aprSample(p.pendingWei, s.pendingWei, s.principalWei, (now.getTime() - prevAt.getTime()) / 1000);
  if (sample === null || !(sample >= 0 && sample <= MAX_APR_SAMPLE)) return p.aprEst;
  if (await ctx.store.hasTxSince(p.id, prevAt)) return p.aprEst;
  return updateEwma(p.aprEst, sample);
}

function nextCheckTime(d: CompoundDecision, etaSec: number, settings: EngineSettings, now: Date): Date {
  let delaySec = nextCheckDelaySec(etaSec, settings.checkMinSec, settings.checkMaxSec);
  if (d.reason === "gas_too_high" || d.reason === "insufficient_gas") delaySec = settings.checkMinSec;
  let t = now.getTime() + delaySec * 1000;
  if (d.nextEligibleAt && d.nextEligibleAt.getTime() > t) t = d.nextEligibleAt.getTime();
  return new Date(t);
}

function skipNote(strategy: PositionRow["strategy"], due: boolean, d: CompoundDecision, pendingWei: bigint): string | null {
  if (d.action !== "skip") return null;
  if (strategy === "schedule") return due ? `skipped: ${d.reason}` : null;
  if (NOTABLE_SKIPS.has(d.reason) && pendingWei >= d.thresholdWei) return `skipped: ${d.reason}`;
  return null;
}

/**
 * One position check (tick): refresh chain state, update APR estimate, decide, persist state + snapshot,
 * and — when the decision is not `skip` and the position is enabled — run the compound.
 */
export async function checkPosition(ctx: EngineCtx, ep: EnginePosition, inputs: EngineInputs): Promise<CheckOutcome> {
  const now = ctx.now();
  const p = ep.position;
  const { settings } = inputs;
  const state = await readChainState(ctx, ep, inputs.gasPriceWei);

  const aprEst = await estimateApr(ctx, p, state, now);
  const apr = aprEst ?? APR_DEFAULT;
  const sched = scheduleState(p, ctx.config.timezone, now);
  const input = buildInput(ep, state, settings, now, sched.due);
  const decision = decideCompound(input);
  const eta = etaSeconds(decision.thresholdWei, state.pendingWei, state.principalWei, apr);

  const invalidSchedule = p.strategy === "schedule" && (!p.cronExpr || sched.nextRunAt === null);
  const note = !p.enabled
    ? null
    : invalidSchedule
      ? "skipped: invalid_schedule (cron_expr ว่างหรือไม่ถูกต้อง)"
      : skipNote(p.strategy, sched.due, decision, state.pendingWei);
  const patch: PositionPatch = {
    principalWei: state.principalWei,
    pendingWei: state.pendingWei,
    liquidWei: state.liquidWei,
    chainSyncedAt: now,
    aprEst,
    rStarWei: decision.rStarWei,
    etaSec: toEtaSec(eta),
    claimOnly: decision.claimOnly,
    lastCheckAt: now,
    nextCheckAt: nextCheckTime(decision, eta, settings, now),
  };
  // advance the schedule before running, so a crash mid-run never re-triggers the same slot
  if (sched.nextRunAt !== undefined) patch.nextRunAt = sched.nextRunAt;
  if (note) {
    patch.lastRunAt = now;
    patch.lastRunResult = note;
  }
  await ctx.store.updatePosition(p.id, patch);
  await ctx.store.insertSnapshot({
    positionId: p.id,
    takenAt: now,
    principalWei: state.principalWei,
    pendingWei: state.pendingWei,
    aprEst,
    rStarWei: decision.rStarWei,
    gasPriceWei: state.gasPriceWei,
  });

  ctx.log.debug(
    {
      positionId: p.id,
      strategy: p.strategy,
      action: decision.action,
      reason: decision.reason,
      principalKub: formatKub(state.principalWei),
      pendingKub: formatKub(state.pendingWei, 6),
      thresholdKub: formatKub(decision.thresholdWei, 6),
    },
    "position checked",
  );

  if (!p.enabled || decision.action === "skip") return { decision, ran: false, result: note };

  const run = await runCompound(ctx, ep, input, { force: false, actionId: null, settings });
  await ctx.store.updatePosition(p.id, { ...run.patch, lastRunAt: now, lastRunResult: run.result });
  ctx.log.info({ positionId: p.id, status: run.status, result: run.result }, "auto-compound run");
  return { decision, ran: true, result: run.result, run };
}

/** Manual compound (action `compound`): fresh chain state, forced decision, run, record the result. */
export async function compoundNow(
  ctx: EngineCtx,
  ep: EnginePosition,
  inputs: EngineInputs,
  actionId: string | null,
): Promise<RunOutcome> {
  const now = ctx.now();
  const state = await readChainState(ctx, ep, inputs.gasPriceWei);
  const input = buildInput(ep, state, inputs.settings, now, true);
  const pre = decideCompound(forcedInput(input));
  let run: RunOutcome;
  if (pre.action === "skip") {
    run = { status: "skipped", result: `skipped: ${pre.reason}`, patch: {}, txId: null, error: reasonText(pre.reason) };
  } else {
    run = await runCompound(ctx, ep, input, { force: true, actionId, settings: inputs.settings });
  }
  // nextCheckAt = now → the next tick refreshes principal/pending after the manual run
  await ctx.store.updatePosition(ep.position.id, {
    ...run.patch,
    lastRunAt: now,
    lastRunResult: `manual: ${run.result}`,
    nextCheckAt: now,
  });
  return run;
}

type RunOpts = { force: boolean; actionId: string | null; settings: EngineSettings };

/**
 * Executes the compound path. Re-reads live share flags + validator status first and re-decides with them
 * (e.g. delegation just got disabled → claim-only). 1-tx = delegate{value: pending}; 2-tx = claim → wait →
 * delegate{value: min(claimed, liquidNow − reserve − C_delegate)}; claim-only = claim.
 */
export async function runCompound(
  ctx: EngineCtx,
  ep: EnginePosition,
  input: CompoundInput,
  opts: RunOpts,
): Promise<RunOutcome> {
  const now = ctx.now();
  const p = ep.position;
  const share = getAddress(ep.validator.shareAddress);
  const user = getAddress(ep.wallet.address);
  const settings = opts.settings;

  const success = (extra: PositionPatch = {}): PositionPatch => ({
    lastCompoundAt: now,
    backoffLevel: 0,
    lastError: null,
    lastFailureAt: null,
    nextCheckAt: addSec(now, settings.checkMinSec),
    ...extra,
  });
  const failure = (msg: string, extra: PositionPatch = {}): PositionPatch => {
    const level = p.backoffLevel + 1;
    return {
      backoffLevel: level,
      lastFailureAt: now,
      lastError: msg,
      nextCheckAt: addSec(now, Math.max(settings.checkMinSec, backoffDelayMs(level) / 1000)),
      ...extra,
    };
  };
  const soon = (): PositionPatch => ({ nextCheckAt: addSec(now, settings.checkMinSec) });

  const outcomeOf = (r: TxResult, label: string, describe: (ev: ShareEventSums) => string, extra: PositionPatch = {}): RunOutcome => {
    switch (r.status) {
      case "confirmed":
        return { status: "done", result: describe(r.events), patch: success(extra), txId: r.txId, error: null };
      case "reverted": {
        const msg = `${label} reverted on-chain (${r.hash})`;
        return { status: "failed", result: `failed: ${msg}`, patch: failure(msg, extra), txId: r.txId, error: msg };
      }
      case "failed": {
        const msg = `${label}: ${r.error}`;
        return { status: "failed", result: `failed: ${msg}`, patch: failure(msg, extra), txId: r.txId, error: msg };
      }
      case "pending":
        return {
          status: "pending",
          result: `pending: ${label} tx ${r.hash} awaiting confirmation`,
          patch: { ...soon(), ...extra },
          txId: r.txId,
          error: null,
        };
    }
  };

  const errorOutcome = (err: unknown, label: string, extra: PositionPatch = {}): RunOutcome => {
    if (err instanceof WalletBusyError) {
      return {
        status: "skipped",
        result: "skipped: tx_in_flight",
        patch: { ...soon(), ...extra },
        txId: null,
        error: err.message,
        busy: true,
      };
    }
    if (err instanceof SimulationError) {
      const msg = `${label}: ${err.reason}`;
      return { status: "failed", result: `failed: ${msg}`, patch: failure(msg, extra), txId: null, error: msg };
    }
    const msg = `${label}: ${errMsg(err)}`;
    if (!(err instanceof KeyAddressMismatchError) && isTransientNetworkError(err)) {
      // RPC hiccup: no backoff, just retry at the next check
      return { status: "failed", result: `error: ${msg}`, patch: { lastError: msg, ...soon(), ...extra }, txId: null, error: msg };
    }
    return { status: "failed", result: `failed: ${msg}`, patch: failure(msg, extra), txId: null, error: msg };
  };

  // 1. live flags + status (never trust the synced validators row for a tx)
  let decision: CompoundDecision;
  try {
    const flags = await ctx.chain.readShareFlags(share);
    const status = await ctx.chain.readValidatorStatus(ep.validator.validatorId);
    await ctx.store
      .updateValidatorLive(ep.validator.validatorId, { status, ...flags })
      .catch((err: unknown) => ctx.log.warn({ err: errMsg(err) }, "could not persist live validator flags"));
    const live: CompoundInput = {
      ...input,
      validatorActive: status === 1,
      delegationEnabled: flags.delegationEnabled,
      paused: flags.paused,
      isOfficialPool: flags.isOfficialPool,
    };
    decision = decideCompound(opts.force ? forcedInput(live) : live);
  } catch (err) {
    return errorOutcome(err, "pre-flight validator check");
  }
  if (decision.action === "skip") {
    return { status: "skipped", result: `skipped: ${decision.reason}`, patch: soon(), txId: null, error: reasonText(decision.reason) };
  }

  // 2. key (decrypted for this run only)
  let account: TxSigner;
  try {
    account = await ctx.accounts.load(ep.wallet.id);
  } catch (err) {
    return errorOutcome(err, "load key");
  }

  const exec = (kind: TxRowKind, data: Hex, value: bigint) =>
    ctx.txManager.execute({ walletId: ep.wallet.id, positionId: p.id, actionId: opts.actionId, kind, to: share, data, value, account });

  switch (decision.action) {
    case "compound_1tx": {
      const value = decision.valueWei;
      if (value <= 0n) return { status: "skipped", result: "skipped: zero_pending", patch: soon(), txId: null, error: reasonText("zero_pending") };
      const label = `compound 1-tx ${formatKub(value)} KUB`;
      try {
        const r = await exec("compound_delegate", encodeDelegate(), value);
        return outcomeOf(r, label, (ev) => `compounded 1-tx ${formatKub(ev.delegatedWei > 0n ? ev.delegatedWei : value)} KUB`);
      } catch (err) {
        return errorOutcome(err, label);
      }
    }
    case "claim_only": {
      const label = "claim (claim-only: validator not accepting delegation)";
      try {
        const r = await exec("compound_claim", encodeClaim(), 0n);
        return outcomeOf(r, label, (ev) => `claimed ${formatKub(ev.claimedWei)} KUB (claim-only: validator not accepting delegation)`);
      } catch (err) {
        return errorOutcome(err, label);
      }
    }
    case "compound_2tx":
      return runTwoTx();
  }

  async function runTwoTx(): Promise<RunOutcome> {
    let claim: TxResult;
    try {
      claim = await exec("compound_claim", encodeClaim(), 0n);
    } catch (err) {
      return errorOutcome(err, "compound 2-tx (claim)");
    }
    if (claim.status !== "confirmed") {
      return outcomeOf(claim, "compound 2-tx (claim, then delegate the claimed amount)", () => "");
    }
    const claimed = claim.events.claimedWei;
    // the claim happened: record it as the last compound even if the restake leg does not
    const claimedPatch: PositionPatch = { lastCompoundAt: now };
    let liquidNow: bigint;
    try {
      liquidNow = await ctx.chain.getBalance(user);
    } catch (err) {
      return { ...errorOutcome(err, `claimed ${formatKub(claimed)} KUB; read balance`, claimedPatch), txId: claim.txId };
    }
    const cDelegate = gasCostWei(input.gasPriceWei, gasLimitFor("delegate", GAS_EST_1TX));
    const budget = liquidNow - settings.gasReserveWei - cDelegate;
    const value = claimed < budget ? claimed : budget;
    if (value <= 0n) {
      return { status: "done", result: "claimed only (insufficient for restake)", patch: success(), txId: claim.txId, error: null };
    }
    const label = `claimed ${formatKub(claimed)} KUB; restake ${formatKub(value)} KUB`;
    try {
      const del = await exec("compound_delegate", encodeDelegate(), value);
      const out = outcomeOf(
        del,
        label,
        (ev) => `compounded 2-tx ${formatKub(ev.delegatedWei > 0n ? ev.delegatedWei : value)} KUB (claimed ${formatKub(claimed)} KUB)`,
        claimedPatch,
      );
      return out.txId ? out : { ...out, txId: claim.txId };
    } catch (err) {
      return { ...errorOutcome(err, label, claimedPatch), txId: claim.txId };
    }
  }
}
