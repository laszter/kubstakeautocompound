import { parseEventLogs, type Address, type Log } from "viem";
import { validatorShareAbi } from "./abis";

export type ShareEventSums = { delegatedWei: bigint; undelegatedWei: bigint; claimedWei: bigint };

/**
 * Sums Delegated / Undelegated / ClaimedRewards amounts in receipt logs emitted by `share` for `user`.
 * Logs from other addresses, for other users, or not in the ABI (e.g. KAP20 Transfer) are ignored.
 * ClaimedRewards is also emitted inside delegate/undelegate when a reward was paid out.
 */
export function decodeShareEvents(logs: Log[], share: Address, user: Address): ShareEventSums {
  const shareLc = share.toLowerCase();
  const userLc = user.toLowerCase();
  const sums: ShareEventSums = { delegatedWei: 0n, undelegatedWei: 0n, claimedWei: 0n };
  const ours = logs.filter((l) => typeof l.address === "string" && l.address.toLowerCase() === shareLc);
  for (const ev of parseEventLogs({ abi: validatorShareAbi, logs: ours, strict: true })) {
    if (ev.args.user.toLowerCase() !== userLc) continue;
    switch (ev.eventName) {
      case "Delegated":
        sums.delegatedWei += ev.args.amount;
        break;
      case "Undelegated":
        sums.undelegatedWei += ev.args.amount;
        break;
      case "ClaimedRewards":
        sums.claimedWei += ev.args.amount;
        break;
    }
  }
  return sums;
}

const trimBase = (base: string) => base.replace(/\/+$/, "");

export function explorerTxUrl(base: string, hash: string): string {
  return `${trimBase(base)}/tx/${hash}`;
}

export function explorerAddressUrl(base: string, addr: string): string {
  return `${trimBase(base)}/address/${addr}`;
}
