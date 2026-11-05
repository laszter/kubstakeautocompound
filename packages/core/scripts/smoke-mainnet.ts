// READ-ONLY KUB Mainnet smoke test: `npm run smoke:mainnet`.
// Uses only eth_chainId / eth_blockNumber / eth_gasPrice / eth_call (readContract) + the optional subgraph.
// It never signs or sends a transaction and never touches a private key.
import { zeroAddress, type Address } from "viem";
import {
  GAS_EST_1TX,
  RPC_URL_DEFAULT,
  SUBGRAPH_URL_DEFAULT,
  assertChainId,
  createKubPublicClient,
  discoverValidators,
  formatGwei,
  formatKub,
  gasCostWei,
  rStarWei,
  readPositionState,
  shortAddr,
  type DiscoveredValidator,
} from "../src/index";

/** Known delegatable validators (TASK §Chain & contracts) — also checks that index == validatorId. */
const KNOWN: Record<number, string> = {
  0: "0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20",
  22: "0x488023dff3f0b063e4c0c2d939d9a10b1aba72e7",
  24: "0x1da3d9b03a6efd3d0b132dd6bdbe494bdb86e298",
  32: "0x18dcc6ea272db3efc6e2c637cae5cd5534be6b1e",
};
const MIN_DELEGATABLE = 5;

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function printTable(rows: DiscoveredValidator[]): void {
  const head = `${padL("id", 3)}  ${pad("name", 30)}  ${pad("share", 13)}  ${padL("delegated KUB", 16)}  ${padL("comm%", 5)}  ${padL("minDel", 7)}  ${pad("delegation", 10)}  flags`;
  console.log(head);
  console.log("-".repeat(head.length + 10));
  for (const v of rows) {
    const flags = [v.paused ? "paused" : "", v.isOfficialPool ? "officialPool" : "", v.inMinimalSet ? "minimalSet" : ""]
      .filter(Boolean)
      .join(",");
    console.log(
      `${padL(String(v.validatorId), 3)}  ${pad(v.name ?? `#${v.validatorId}`, 30)}  ${pad(shortAddr(v.shareAddress), 13)}  ${padL(
        formatKub(v.delegatedWei, 0),
        16,
      )}  ${padL((v.commissionBps / 100).toFixed(2), 5)}  ${padL(formatKub(v.minDelegatedWei, 2), 7)}  ${pad(
        v.delegationEnabled ? "yes" : "NO",
        10,
      )}  ${flags}`,
    );
  }
}

async function main(): Promise<number> {
  const rpcUrl = process.env.RPC_URL || RPC_URL_DEFAULT;
  const subgraphUrl = process.env.SUBGRAPH_URL ?? SUBGRAPH_URL_DEFAULT;
  const concurrency = Math.min(4, Math.max(1, Number(process.env.RPC_CONCURRENCY ?? 3) || 3));
  console.log(`[smoke] READ-ONLY  rpc=${rpcUrl}  concurrency=${concurrency}  subgraph=${subgraphUrl || "(disabled)"}`);

  const client = createKubPublicClient(rpcUrl);
  await assertChainId(client);
  const [blockNumber, gasPrice] = [await client.getBlockNumber(), await client.getGasPrice()];
  console.log(`[smoke] chainId 96 OK  block=${blockNumber}  gasPrice=${formatGwei(gasPrice)} gwei`);

  const t0 = Date.now();
  const validators = await discoverValidators(client, {
    concurrency,
    subgraphUrl,
    log: (m) => console.log(`[smoke] ${m}`),
  });
  console.log(`[smoke] discovered ${validators.length} active validators in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  printTable(validators);

  const delegatable = validators.filter((v) => v.delegationEnabled && !v.paused && !v.isOfficialPool && v.status === 1);
  const withDelegation = validators.filter((v) => v.delegationEnabled);
  const named = validators.filter((v) => v.name).length;
  console.log(
    `\n[smoke] delegation=true: ${withDelegation.length}  delegatable (delegation && !paused && !officialPool): ${delegatable.length}  subgraph names: ${named}/${validators.length}`,
  );

  // Position read path (zero address → expect principal 0).
  const kub = validators.find((v) => v.validatorId === 0);
  if (kub) {
    const pos = await readPositionState(client, kub.shareAddress, zeroAddress as Address);
    console.log(`[smoke] readPositionState(id0, 0x0): principal=${formatKub(pos.principalWei)} pending=${formatKub(pos.pendingWei)}`);
  }
  const c1 = gasCostWei(gasPrice, GAS_EST_1TX);
  console.log(
    `[smoke] hint @ live gas: C_1tx=${formatKub(c1, 6)} KUB → R*(10,000 KUB)=${formatKub(rStarWei(c1, 10_000n * 10n ** 18n), 3)} KUB`,
  );

  const problems: string[] = [];
  if (withDelegation.length < MIN_DELEGATABLE) problems.push(`only ${withDelegation.length} validators with delegation=true (< ${MIN_DELEGATABLE})`);
  for (const [idStr, share] of Object.entries(KNOWN)) {
    const v = validators.find((x) => x.validatorId === Number(idStr));
    if (!v) problems.push(`validator id ${idStr} missing`);
    else if (v.shareAddress.toLowerCase() !== share) problems.push(`validator id ${idStr} share ${v.shareAddress} != expected ${share}`);
    else if (!v.delegationEnabled) problems.push(`validator id ${idStr} has delegation=false`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`[smoke] FAIL: ${p}`);
    return 1;
  }
  console.log("[smoke] OK (no transactions were sent)");
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error("[smoke] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
