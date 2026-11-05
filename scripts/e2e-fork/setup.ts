// Mainnet-FORK e2e driver (T11) — run by scripts/e2e-fork.sh, never against a real network.
//
//   tsx setup.ts seed   (before the worker starts)
//     validator 0 read from the fork → validators row (so the worker does not need a full discovery);
//     fresh throwaway key → funded ONLY on the fork (anvil_setBalance) → encrypted with the e2e MASTER_KEY
//     exactly like the web app does → wallets + positions rows (enabled=false: manual actions only).
//
//   tsx setup.ts flow   (worker running with DRY_RUN=false, RPC_URL=http://anvil:8545)
//     1 delegate 100 KUB (action) → 2 inject a reward (distributeReward from validator 0's signer as
//     block.coinbase) → 3 compound (action, 1-tx) → 4 auto-compound by the engine (position enabled) →
//     5 inject + claim (action) → 6 undelegate everything (action).
//     Every step waits for the worker to finish the action and checks the txs row + on-fork state.
//
// The private key is generated here, kept in memory only, and never printed or written in plaintext.
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { encodeFunctionData, parseEventLogs, zeroAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ADDRESSES,
  encryptPrivateKey,
  parseMasterKey,
  readShareFlags,
  stakeManagerStorageAbi,
  validatorShareAbi,
} from "@kubstake/core";
import {
  actions,
  createDb,
  enqueueAction,
  positions,
  txs,
  upsertValidators,
  wallets,
  type ActionRow,
  type ActionType,
  type Db,
  type TxRow,
} from "@kubstake/db";
import {
  DELEGATE_WEI,
  EXPECTED_SHARE,
  EXPECTED_SIGNER,
  FUND_WEI,
  KUB,
  REWARD_INJECTION_WEI,
  VALIDATOR_ID,
  assertAnvilFork,
  clients,
  fmtKub,
  loadConfig,
  readState,
  sleep,
  stakeManagerRewardAbi,
  writeState,
  type E2eConfig,
  type E2eState,
  type StepRecord,
} from "./common";

const ACTION_TIMEOUT_MS = 150_000;
const AUTO_TIMEOUT_MS = 90_000;

const t0 = Date.now();
const log = (msg: string) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

class StepFailed extends Error {}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new StepFailed(msg);
}

// -------------------------------------------------------------------------------------------------
// seed
// -------------------------------------------------------------------------------------------------
async function seed(cfg: E2eConfig): Promise<void> {
  const fork = await assertAnvilFork(cfg.rpcUrl);
  log(`anvil OK: ${fork.clientVersion}, fork block ${fork.forkBlockNumber ?? "?"}, hardfork ${fork.hardfork ?? "?"}`);
  const { pub, test } = clients(cfg.rpcUrl);
  const { db, pool } = createDb(cfg.databaseUrl, { max: 2 });
  try {
    const info = await pub.readContract({
      address: ADDRESSES.stakeManagerStorage,
      abi: stakeManagerStorageAbi,
      functionName: "getValidatorInfoByIndex",
      args: [BigInt(VALIDATOR_ID)],
    });
    const share = info.validatorShareContract.toLowerCase() as Address;
    expect(share === EXPECTED_SHARE, `validator ${VALIDATOR_ID} share is ${share}, expected ${EXPECTED_SHARE}`);
    if (info.signer.toLowerCase() !== EXPECTED_SIGNER) log(`note: validator 0 signer is now ${info.signer} (RECON had ${EXPECTED_SIGNER})`);
    const [flags, totalSupplyWei, inMinimalSet] = await Promise.all([
      readShareFlags(pub, share),
      pub.readContract({ address: share, abi: validatorShareAbi, functionName: "totalSupply" }),
      pub.readContract({
        address: ADDRESSES.stakeManagerStorage,
        abi: stakeManagerStorageAbi,
        functionName: "isInMinimalValidatorListByValidatorId",
        args: [BigInt(VALIDATOR_ID)],
      }),
    ]);
    expect(
      Number(info.status) === 1 && flags.delegationEnabled && !flags.paused && !flags.isOfficialPool,
      `validator ${VALIDATOR_ID} is not delegatable on the fork (status ${info.status}, flags ${JSON.stringify(flags, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))})`,
    );
    await upsertValidators(
      db,
      [
        {
          validatorId: VALIDATOR_ID,
          shareAddress: share,
          signer: info.signer,
          status: Number(info.status),
          commissionBps: Number(info.commissionRate),
          infraCommissionBps: Number(info.infraCommissionRate),
          selfStakeWei: info.amount,
          delegatedWei: info.delegatedAmount,
          minDelegatedWei: flags.minDelegatedWei,
          delegationEnabled: flags.delegationEnabled,
          paused: flags.paused,
          isOfficialPool: flags.isOfficialPool,
          inMinimalSet,
          totalSupplyWei,
          name: "KUB (fork e2e)",
        },
      ],
      new Date(),
    );
    log(
      `validator ${VALIDATOR_ID}: share ${share}, signer ${info.signer}, totalSupply ${fmtKub(totalSupplyWei, 0)} KUB, ` +
        `commission ${Number(info.commissionRate)} bps, infra ${Number(info.infraCommissionRate)} bps, minDelegated ${fmtKub(flags.minDelegatedWei, 2)}`,
    );

    // fresh throwaway key: 0 KUB on the real chain, funded on this fork only
    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    await test.setBalance({ address, value: FUND_WEI });
    const encryptedKey = encryptPrivateKey(parseMasterKey(cfg.masterKey), pk, address.toLowerCase());
    const [w] = await db.insert(wallets).values({ label: "e2e-fork throwaway", address, encryptedKey }).returning({ id: wallets.id });
    expect(w, "wallet insert returned no row");
    // enabled=false: no auto-compound race with the manual actions (step 4 enables it on purpose)
    const [p] = await db
      .insert(positions)
      .values({ walletId: w.id, validatorId: VALIDATOR_ID, enabled: false, strategy: "optimal" })
      .returning({ id: positions.id });
    expect(p, "position insert returned no row");
    log(`throwaway wallet ${address} funded with ${fmtKub(FUND_WEI, 0)} KUB on the fork; wallet ${w.id}, position ${p.id}`);

    const state: E2eState = {
      startedAt: new Date().toISOString(),
      fork,
      address,
      walletId: w.id,
      positionId: p.id,
      share,
      signer: info.signer,
      rewardInjections: [],
      steps: [],
    };
    writeState(cfg.stateFile, state);
  } finally {
    await pool.end();
  }
}

// -------------------------------------------------------------------------------------------------
// flow
// -------------------------------------------------------------------------------------------------
type Ctx = { cfg: E2eConfig; db: Db; state: E2eState; c: ReturnType<typeof clients> };

const principalOf = (x: Ctx) =>
  x.c.pub.readContract({ address: x.state.share, abi: validatorShareAbi, functionName: "balanceOf", args: [x.state.address] });
const pendingOf = (x: Ctx) =>
  x.c.pub.readContract({ address: x.state.share, abi: validatorShareAbi, functionName: "getLiquidRewards", args: [x.state.address] });

function describeTx(tx: TxRow | undefined): string {
  if (!tx) return "no tx";
  return (
    `${tx.kind} ${tx.status} ${tx.hash} gasUsed=${tx.gasUsed ?? "-"} value=${fmtKub(tx.valueWei)} ` +
    `delegated=${fmtKub(tx.eventDelegatedWei)} claimed=${fmtKub(tx.eventClaimedWei)} undelegated=${fmtKub(tx.eventUndelegatedWei)}`
  );
}

function record(x: Ctx, rec: StepRecord): void {
  x.state.steps.push(rec);
  writeState(x.cfg.stateFile, x.state);
}

/** Enqueue like the web app does, then wait for the worker to finish the action. */
async function runAction(x: Ctx, step: string, type: ActionType, amountWei?: bigint): Promise<{ action: ActionRow; tx?: TxRow }> {
  const started = Date.now();
  const { id, created } = await enqueueAction(x.db, { type, positionId: x.state.positionId, amountWei: amountWei ?? null, requestedBy: "ui" });
  expect(created, `${step}: an open ${type} action already existed`);
  let action: ActionRow | undefined;
  for (;;) {
    [action] = await x.db.select().from(actions).where(eq(actions.id, id));
    if (action && action.status !== "pending" && action.status !== "running") break;
    expect(Date.now() - started < ACTION_TIMEOUT_MS, `${step}: action ${id} still '${action?.status}' after ${ACTION_TIMEOUT_MS / 1000}s`);
    await sleep(500);
  }
  const [tx] = action.txId ? await x.db.select().from(txs).where(eq(txs.id, action.txId)) : [];
  const actionMs = Date.now() - started;
  const receiptMs = tx?.broadcastAt && tx.confirmedAt ? tx.confirmedAt.getTime() - tx.broadcastAt.getTime() : undefined;
  log(`${step}: action ${action.status} in ${(actionMs / 1000).toFixed(1)}s${action.error ? ` (error: ${action.error})` : ""} — ${describeTx(tx)}`);
  record(x, {
    step,
    actionId: id,
    actionStatus: action.status,
    actionError: action.error,
    txHash: tx?.hash,
    txKind: tx?.kind,
    actionMs,
    receiptMs,
  });
  return { action, tx };
}

/**
 * StakeManagerV2.distributeReward() is `onlyCoinbase` and credits getValidatorId(msg.sender) — so the
 * reward for validator 0 is sent BY validator 0's signer while it is block.coinbase (as on mainnet,
 * where the block producer pays the block's fees into its own pool).
 */
async function injectReward(x: Ctx, label: string): Promise<bigint> {
  const { pub, test, wallet } = x.c;
  const signer = x.state.signer;
  const data = encodeFunctionData({ abi: stakeManagerRewardAbi, functionName: "distributeReward" });
  await test.impersonateAccount({ address: signer });
  await test.setBalance({ address: signer, value: REWARD_INJECTION_WEI + 10n * KUB });
  await test.setCoinbase({ address: signer });
  try {
    let simulated: string | null = null;
    try {
      await pub.call({ account: signer, to: ADDRESSES.stakeManager, data, value: REWARD_INJECTION_WEI });
    } catch (err) {
      simulated = err instanceof Error ? err.message.split("\n")[0] ?? String(err) : String(err);
    }
    const hash = await wallet.sendTransaction({
      account: signer, // impersonated → eth_sendTransaction on anvil
      to: ADDRESSES.stakeManager,
      data,
      value: REWARD_INJECTION_WEI,
      gas: 1_000_000n,
    });
    await test.mine({ blocks: 1 });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 500 });
    expect(receipt.status === "success", `${label}: distributeReward reverted (${hash})${simulated ? ` — simulation: ${simulated}` : ""}`);
    const [ev] = parseEventLogs({ abi: stakeManagerRewardAbi, logs: receipt.logs, eventName: "DistributeRewards" });
    expect(ev && ev.args.validatorId === BigInt(VALIDATOR_ID), `${label}: no DistributeRewards event for validator ${VALIDATOR_ID} (${hash})`);
    const liquid = await pendingOf(x);
    expect(liquid > 0n, `${label}: getLiquidRewards is still 0 after distributeReward (${hash})`);
    log(
      `${label}: distributeReward ${fmtKub(REWARD_INJECTION_WEI, 0)} KUB from ${signer} (tx ${hash}) → delegatorsReward ` +
        `${fmtKub(ev.args.delegatorsReward, 4)} KUB pool-wide; our getLiquidRewards = ${fmtKub(liquid)} KUB`,
    );
    x.state.rewardInjections.push({ hash, delegatorsRewardWei: ev.args.delegatorsReward.toString(), liquidAfterWei: liquid.toString() });
    writeState(x.cfg.stateFile, x.state);
    return liquid;
  } finally {
    await test.setCoinbase({ address: zeroAddress }).catch(() => {});
    await test.stopImpersonatingAccount({ address: signer }).catch(() => {});
  }
}

async function positionRow(x: Ctx) {
  const [p] = await x.db.select().from(positions).where(eq(positions.id, x.state.positionId));
  expect(p, "position row disappeared");
  return p;
}

async function flow(cfg: E2eConfig): Promise<void> {
  await assertAnvilFork(cfg.rpcUrl);
  const state = readState(cfg.stateFile);
  const { db, pool } = createDb(cfg.databaseUrl, { max: 2 });
  const x: Ctx = { cfg, db, state, c: clients(cfg.rpcUrl) };
  try {
    // 1. delegate 100 KUB ------------------------------------------------------------------------
    {
      const { action, tx } = await runAction(x, "1 delegate", "delegate", DELEGATE_WEI);
      expect(action.status === "done", `delegate: action ${action.status}: ${action.error}`);
      expect(tx && tx.kind === "delegate" && tx.status === "confirmed", `delegate: tx not confirmed (${describeTx(tx)})`);
      expect(tx.eventDelegatedWei === DELEGATE_WEI, `delegate: Delegated event ${tx.eventDelegatedWei} != ${DELEGATE_WEI}`);
      const principal = await principalOf(x);
      expect(principal === DELEGATE_WEI, `delegate: on-fork balanceOf ${principal} != ${DELEGATE_WEI}`);
    }

    // 2. reward ------------------------------------------------------------------------------------
    const pending1 = await injectReward(x, "2 reward");

    // 3. manual compound (1-tx: delegate{value: pending}, the share auto-claims first) -------------
    {
      const principalBefore = await principalOf(x);
      const { action, tx } = await runAction(x, "3 compound", "compound");
      expect(action.status === "done", `compound: action ${action.status}: ${action.error}`);
      expect(tx && tx.kind === "compound_delegate" && tx.status === "confirmed", `compound: tx not confirmed (${describeTx(tx)})`);
      expect((tx.eventClaimedWei ?? 0n) > 0n, "compound: ClaimedRewards amount is 0");
      expect((tx.eventDelegatedWei ?? 0n) > 0n, "compound: Delegated amount is 0");
      expect(tx.eventDelegatedWei === pending1, `compound: delegated ${tx.eventDelegatedWei} != pending before ${pending1}`);
      const p = await positionRow(x);
      expect(p.lastCompoundAt, "compound: positions.last_compound_at not set");
      expect(p.lastRunResult?.startsWith("manual: compounded 1-tx"), `compound: last_run_result = ${p.lastRunResult}`);
      const principalAfter = await principalOf(x);
      expect(
        principalAfter === principalBefore + (tx.eventDelegatedWei ?? 0n),
        `compound: principal ${principalAfter} != ${principalBefore} + ${tx.eventDelegatedWei}`,
      );
      const pendingAfter = await pendingOf(x);
      expect(pendingAfter === 0n, `compound: pending after auto-claim is ${pendingAfter}, expected 0`);
      log(`3 compound: principal ${fmtKub(principalBefore)} → ${fmtKub(principalAfter)} KUB; last_run_result "${p.lastRunResult}"`);
    }

    // 4. auto-compound by the engine (optimal mode: pending ≥ max(R*, R_FLOOR)) ---------------------
    {
      const pending = await injectReward(x, "4 reward");
      const principalBefore = await principalOf(x);
      // pretend the last compound was 2h ago (MIN_INTERVAL_SEC ≥ 3600 is enforced) and make the check due now.
      // enabledAt comes from the DB clock (worker + db share the Docker VM clock; the host may drift).
      const [upd] = await db
        .update(positions)
        .set({ enabled: true, lastCompoundAt: sql`now() - interval '2 hours'`, nextCheckAt: sql`now()` })
        .where(eq(positions.id, state.positionId))
        .returning({ at: sql<string>`now()` });
      const enabledAt = new Date(String(upd?.at));
      expect(!Number.isNaN(enabledAt.getTime()), "auto-compound: could not read DB now()");
      const started = Date.now();
      let tx: TxRow | undefined;
      for (;;) {
        [tx] = await db
          .select()
          .from(txs)
          .where(and(eq(txs.positionId, state.positionId), isNull(txs.actionId), gt(txs.createdAt, enabledAt)))
          .orderBy(desc(txs.createdAt))
          .limit(1);
        if (tx && tx.status !== "signed" && tx.status !== "broadcast") {
          // the engine writes last_run_result right after execute() returns
          const p = await positionRow(x);
          if (p.lastRunAt && p.lastRunAt.getTime() >= enabledAt.getTime()) break;
        }
        if (Date.now() - started > AUTO_TIMEOUT_MS) {
          const p = await positionRow(x);
          throw new StepFailed(
            `auto-compound: no engine tx after ${AUTO_TIMEOUT_MS / 1000}s (pending_wei=${p.pendingWei}, r_star_wei=${p.rStarWei}, ` +
              `last_check_at=${p.lastCheckAt?.toISOString()}, last_run_result=${p.lastRunResult}, last_error=${p.lastError})`,
          );
        }
        await sleep(500);
      }
      await db.update(positions).set({ enabled: false }).where(eq(positions.id, state.positionId));
      const p = await positionRow(x);
      const ms = Date.now() - started;
      log(`4 auto: engine ran in ${(ms / 1000).toFixed(1)}s — ${describeTx(tx)}; last_run_result "${p.lastRunResult}"`);
      record(x, {
        step: "4 auto-compound",
        txHash: tx.hash,
        txKind: tx.kind,
        actionMs: ms,
        receiptMs: tx.broadcastAt && tx.confirmedAt ? tx.confirmedAt.getTime() - tx.broadcastAt.getTime() : undefined,
        note: p.lastRunResult ?? undefined,
      });
      expect(tx.kind === "compound_delegate" && tx.status === "confirmed", `auto-compound: ${describeTx(tx)}`);
      expect(tx.eventDelegatedWei === pending && tx.eventClaimedWei === pending, `auto-compound: amounts != pending ${pending}`);
      expect(p.lastRunResult?.startsWith("compounded 1-tx"), `auto-compound: last_run_result = ${p.lastRunResult}`);
      const principalAfter = await principalOf(x);
      expect(principalAfter === principalBefore + pending, `auto-compound: principal ${principalAfter} != ${principalBefore} + ${pending}`);
    }

    // 5. reward + claim -------------------------------------------------------------------------
    {
      const pending = await injectReward(x, "5 reward");
      const { action, tx } = await runAction(x, "5 claim", "claim");
      expect(action.status === "done", `claim: action ${action.status}: ${action.error}`);
      expect(tx && tx.kind === "claim" && tx.status === "confirmed", `claim: tx not confirmed (${describeTx(tx)})`);
      expect(tx.eventClaimedWei === pending, `claim: ClaimedRewards ${tx.eventClaimedWei} != pending ${pending}`);
      expect((await pendingOf(x)) === 0n, "claim: getLiquidRewards not 0 after claim");
    }

    // 6. undelegate everything --------------------------------------------------------------------
    {
      const principal = await principalOf(x);
      const { action, tx } = await runAction(x, "6 undelegate", "undelegate", principal);
      expect(action.status === "done", `undelegate: action ${action.status}: ${action.error}`);
      expect(tx && tx.kind === "undelegate" && tx.status === "confirmed", `undelegate: tx not confirmed (${describeTx(tx)})`);
      expect(tx.eventUndelegatedWei === principal, `undelegate: Undelegated ${tx.eventUndelegatedWei} != principal ${principal}`);
      const after = await principalOf(x);
      expect(after === 0n, `undelegate: on-fork balanceOf is ${after}, expected 0`);
    }

    state.flowCompleted = true;
    writeState(cfg.stateFile, state);
    log("flow completed");
  } finally {
    await pool.end();
  }
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  const cfg = loadConfig();
  if (mode === "seed") await seed(cfg);
  else if (mode === "flow") await flow(cfg);
  else throw new Error("usage: tsx scripts/e2e-fork/setup.ts seed|flow (run via npm run e2e:fork)");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[e2e] FAILED: ${err instanceof Error ? (err instanceof StepFailed ? err.message : (err.stack ?? err.message)) : String(err)}`);
    process.exit(1);
  },
);
