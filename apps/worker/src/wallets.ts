import { getAddress } from "viem";
import { eq } from "drizzle-orm";
import { wallets } from "@kubstake/db";
import type { WorkerCtx } from "./context";
import { errMsg } from "./errors";

/** getBalance for every wallet (through the shared RPC limiter) → wallets.balance_wei / balance_updated_at. */
export async function refreshWalletBalances(ctx: WorkerCtx): Promise<{ ok: number; failed: number }> {
  const rows = await ctx.db.select({ id: wallets.id, address: wallets.address }).from(wallets);
  const results = await Promise.allSettled(
    rows.map(async (w) => {
      const balanceWei = await ctx.chain.getBalance(getAddress(w.address));
      await ctx.db.update(wallets).set({ balanceWei, balanceUpdatedAt: ctx.now() }).where(eq(wallets.id, w.id));
    }),
  );
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed++;
      ctx.log.warn({ walletId: rows[i]?.id, err: errMsg(r.reason) }, "wallet balance refresh failed");
    }
  });
  if (failed > 0 && failed === rows.length) throw new Error(`wallet balance refresh failed for all ${failed} wallets`);
  return { ok: rows.length - failed, failed };
}
