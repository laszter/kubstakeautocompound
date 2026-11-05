import type { Address, PublicClient } from "viem";
import { validatorShareAbi } from "./abis";
import { unlimited, type Limiter } from "./client";

/**
 * Position = wallet × ValidatorShare. principal = balanceOf (1 share = 1 KUB),
 * pending = getLiquidRewards (already net of commission).
 */
export async function readPositionState(
  client: PublicClient,
  share: Address,
  user: Address,
  limit: Limiter = unlimited,
): Promise<{ principalWei: bigint; pendingWei: bigint }> {
  const [principalWei, pendingWei] = await Promise.all([
    limit(() => client.readContract({ address: share, abi: validatorShareAbi, functionName: "balanceOf", args: [user] })),
    limit(() =>
      client.readContract({ address: share, abi: validatorShareAbi, functionName: "getLiquidRewards", args: [user] }),
    ),
  ]);
  return { principalWei, pendingWei };
}
