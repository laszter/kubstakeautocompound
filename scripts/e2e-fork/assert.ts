// Mainnet-FORK e2e verification (T11) — run by scripts/e2e-fork.sh after setup.ts flow.
// Re-checks everything independently of setup.ts, from the e2e DB and the anvil fork:
//   * every txs row of the throwaway wallet: hash == keccak256(signed_raw), the signed tx is legacy /
//     chainId 96 / from the wallet / to the share, its on-fork receipt is success and matches the stored
//     block + gasUsed, and the events decoded from the receipt match the event_* columns
//   * the expected tx sequence happened (delegate, manual compound, auto compound, claim, undelegate)
//   * wallet balance on the fork == funded amount + Σ(claimed + undelegated − value − gas fee) (exact wei)
//   * actions all done, heartbeat dry_run=false, position refreshed (principal 0, last_compound_at set)
// Prints a summary table; exits 1 when any check fails.
import { asc, eq } from "drizzle-orm";
import { getAddress, keccak256, parseTransaction, type Hex } from "viem";
import { CHAIN_ID, decodeShareEvents, validatorShareAbi } from "@kubstake/core";
import { actions, createDb, positions, txs, wallets, workerHeartbeat } from "@kubstake/db";
import { FUND_WEI, assertAnvilFork, clients, fmtKub, loadConfig, readState, sleep } from "./common";

type Check = { name: string; ok: boolean; detail?: string };

async function main(): Promise<number> {
  const cfg = loadConfig();
  const fork = await assertAnvilFork(cfg.rpcUrl);
  const state = readState(cfg.stateFile);
  const { pub } = clients(cfg.rpcUrl);
  const { db, pool } = createDb(cfg.databaseUrl, { max: 2 });
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  try {
    check("setup flow completed every step", state.flowCompleted === true);

    const [hb] = await db.select().from(workerHeartbeat).where(eq(workerHeartbeat.id, 1));
    check("worker heartbeat: dry_run=false, chain_id=96", !!hb && hb.dryRun === false && hb.chainId === CHAIN_ID, `dry_run=${hb?.dryRun} chain_id=${hb?.chainId}`);

    const [w] = await db.select({ id: wallets.id, address: wallets.address, enc: wallets.encryptedKey }).from(wallets).where(eq(wallets.id, state.walletId));
    check("wallet row: checksummed address, v1: ciphertext", !!w && w.address === getAddress(state.address) && w.enc.startsWith("v1:"));

    // ---- txs ----------------------------------------------------------------------------------
    const rows = await db.select().from(txs).where(eq(txs.walletId, state.walletId)).orderBy(asc(txs.createdAt));
    const kinds = rows.map((r) => `${r.kind}${r.actionId ? "" : "(engine)"}`);
    const expected = ["delegate", "compound_delegate", "compound_delegate(engine)", "claim", "undelegate"];
    check("tx sequence", JSON.stringify(kinds) === JSON.stringify(expected), kinds.join(", "));

    let expectedBalance = FUND_WEI;
    let gasTotal = 0n;
    const table: string[][] = [];
    for (const r of rows) {
      const tag = `${r.kind} ${r.hash.slice(0, 10)}`;
      check(`${tag}: status confirmed`, r.status === "confirmed", r.status);
      check(`${tag}: hash == keccak256(signed_raw)`, keccak256(r.signedRaw as Hex) === r.hash);
      const parsed = parseTransaction(r.signedRaw as Hex);
      check(
        `${tag}: signed legacy tx, chainId 96, nonce ${r.nonce}`,
        parsed.type === "legacy" && parsed.chainId === CHAIN_ID && parsed.nonce === r.nonce && parsed.gasPrice === r.gasPriceWei,
        `type=${parsed.type} chainId=${parsed.chainId} nonce=${parsed.nonce}`,
      );
      const receipt = await pub.getTransactionReceipt({ hash: r.hash as Hex });
      check(`${tag}: on-fork receipt success`, receipt.status === "success", receipt.status);
      check(
        `${tag}: receipt from/to = wallet/share`,
        receipt.from.toLowerCase() === state.address.toLowerCase() && receipt.to?.toLowerCase() === state.share.toLowerCase(),
      );
      check(
        `${tag}: block + gasUsed match DB`,
        receipt.blockNumber === r.blockNumber && receipt.gasUsed === r.gasUsed,
        `chain ${receipt.blockNumber}/${receipt.gasUsed} db ${r.blockNumber}/${r.gasUsed}`,
      );
      check(`${tag}: gasUsed <= gas_limit`, receipt.gasUsed <= r.gasLimit, `${receipt.gasUsed} / ${r.gasLimit}`);
      const ev = decodeShareEvents(receipt.logs, getAddress(state.share), getAddress(state.address));
      check(
        `${tag}: receipt events == DB event_* columns`,
        ev.delegatedWei === (r.eventDelegatedWei ?? 0n) && ev.claimedWei === (r.eventClaimedWei ?? 0n) && ev.undelegatedWei === (r.eventUndelegatedWei ?? 0n),
      );
      const fee = receipt.gasUsed * receipt.effectiveGasPrice;
      gasTotal += fee;
      expectedBalance += ev.claimedWei + ev.undelegatedWei - r.valueWei - fee;
      table.push([
        r.kind + (r.actionId ? "" : " (engine)"),
        r.status,
        r.hash,
        String(r.blockNumber ?? "-"),
        `${r.gasUsed ?? "-"}/${r.gasLimit}`,
        fmtKub(r.valueWei),
        fmtKub(r.eventDelegatedWei),
        fmtKub(r.eventClaimedWei),
        fmtKub(r.eventUndelegatedWei),
        r.broadcastAt && r.confirmedAt ? `${((r.confirmedAt.getTime() - r.broadcastAt.getTime()) / 1000).toFixed(1)}s` : "-",
      ]);
    }

    // ---- actions --------------------------------------------------------------------------------
    const acts = await db.select().from(actions).where(eq(actions.positionId, state.positionId)).orderBy(asc(actions.createdAt));
    check(
      "actions delegate, compound, claim, undelegate all done",
      JSON.stringify(acts.map((a) => `${a.type}:${a.status}`)) === JSON.stringify(["delegate:done", "compound:done", "claim:done", "undelegate:done"]),
      acts.map((a) => `${a.type}:${a.status}${a.error ? `(${a.error})` : ""}`).join(", "),
    );

    // ---- on-fork end state ------------------------------------------------------------------------
    const [principal, pending, balance] = await Promise.all([
      pub.readContract({ address: state.share, abi: validatorShareAbi, functionName: "balanceOf", args: [state.address] }),
      pub.readContract({ address: state.share, abi: validatorShareAbi, functionName: "getLiquidRewards", args: [state.address] }),
      pub.getBalance({ address: state.address }),
    ]);
    check("on-fork principal (balanceOf) == 0", principal === 0n, fmtKub(principal));
    check("on-fork pending (getLiquidRewards) == 0", pending === 0n, fmtKub(pending));
    check(
      "on-fork wallet balance == fund + Σ(claimed + undelegated − value − gas)",
      balance === expectedBalance,
      `chain ${fmtKub(balance, 18)} expected ${fmtKub(expectedBalance, 18)}`,
    );

    // ---- position row (worker refreshes it on the next tick after the last action) -----------------
    let pos = (await db.select().from(positions).where(eq(positions.id, state.positionId)))[0];
    for (let i = 0; i < 40 && pos && pos.principalWei !== 0n; i++) {
      await sleep(500);
      pos = (await db.select().from(positions).where(eq(positions.id, state.positionId)))[0];
    }
    check("position: principal_wei refreshed to 0 by the worker", pos?.principalWei === 0n, String(pos?.principalWei));
    check("position: last_compound_at set", !!pos?.lastCompoundAt, pos?.lastCompoundAt?.toISOString());
    check("position: backoff_level 0, no last_error", pos?.backoffLevel === 0 && !pos.lastError, `backoff=${pos?.backoffLevel} last_error=${pos?.lastError}`);

    // ---- report ----------------------------------------------------------------------------------
    console.log("");
    console.log(`fork: ${fork.clientVersion} @ block ${fork.forkBlockNumber ?? "?"} (hardfork ${fork.hardfork ?? "?"}); wallet ${state.address}`);
    printTable(["tx", "status", "hash", "block", "gasUsed/limit", "value", "delegated", "claimed", "undelegated", "receipt"], table);
    console.log("");
    printTable(
      ["step", "action", "tx", "action time", "broadcast→receipt"],
      state.steps.map((s) => [
        s.step,
        s.actionStatus ?? (s.note ? "engine" : "-"),
        s.txHash ? `${s.txKind} ${s.txHash.slice(0, 12)}…` : "-",
        s.actionMs !== undefined ? `${(s.actionMs / 1000).toFixed(1)}s` : "-",
        s.receiptMs !== undefined ? `${(s.receiptMs / 1000).toFixed(1)}s` : "-",
      ]),
    );
    console.log("");
    for (const r of state.rewardInjections) {
      console.log(`reward injection ${r.hash}: delegatorsReward ${fmtKub(r.delegatorsRewardWei, 4)} KUB → our pending ${fmtKub(r.liquidAfterWei)} KUB`);
    }
    console.log(`total gas paid: ${fmtKub(gasTotal, 9)} KUB · final wallet balance ${fmtKub(balance)} KUB (funded ${fmtKub(FUND_WEI, 0)})`);
    console.log("");
    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail && !c.ok ? `  [${c.detail}]` : ""}`);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    return failed.length === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}

function printTable(head: string[], rows: string[][]): void {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[e2e] assert crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
