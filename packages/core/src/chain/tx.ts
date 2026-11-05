import { encodeFunctionData, type Hex } from "viem";
import { validatorShareAbi } from "./abis";

// Pure calldata encoders — nothing here signs or sends.

/** `delegate()` payable (selector 0xc89e4361). Value = amount to stake; auto-claims pending reward first. */
export function encodeDelegate(): Hex {
  return encodeFunctionData({ abi: validatorShareAbi, functionName: "delegate" });
}

/** `undelegate(uint256)` (selector 0x6c68c0e1). If balance − amount < minDelegated the contract withdraws everything. */
export function encodeUndelegate(amountWei: bigint): Hex {
  if (amountWei <= 0n) throw new Error("encodeUndelegate: amount must be > 0");
  return encodeFunctionData({ abi: validatorShareAbi, functionName: "undelegate", args: [amountWei] });
}

/** `claimRewards()` (selector 0x372500ab). */
export function encodeClaim(): Hex {
  return encodeFunctionData({ abi: validatorShareAbi, functionName: "claimRewards" });
}

export type TxKind = "delegate" | "undelegate" | "claim";

/** Gas-limit floors: a real delegate once ran out of gas when estimated without pending reward (RECON §2). */
export const GAS_LIMIT_FLOOR: Record<TxKind, bigint> = { delegate: 260_000n, claim: 140_000n, undelegate: 230_000n };

/** max(estimated × 1.25, floor). */
export function gasLimitFor(kind: TxKind, estimated: bigint): bigint {
  const padded = (estimated * 125n) / 100n;
  const floor = GAS_LIMIT_FLOOR[kind];
  return padded > floor ? padded : floor;
}
