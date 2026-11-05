import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { validatorShareAbi } from "./abis";
import { decodeShareEvents, explorerAddressUrl, explorerTxUrl } from "./events";

const SHARE = "0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20" as Address; // id 0 (KUB official)
const OTHER_SHARE = "0x488023dff3f0b063e4c0c2d939d9a10b1aba72e7" as Address;
const USER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER_USER = "0x2222222222222222222222222222222222222222" as Address;
const E18 = 10n ** 18n;

let logIndex = 0;
function shareLog(
  eventName: "Delegated" | "Undelegated" | "ClaimedRewards",
  user: Address,
  amount: bigint,
  address: Address = SHARE,
): Log {
  const topics = encodeEventTopics({ abi: validatorShareAbi, eventName, args: { validatorId: 0n, user } });
  return {
    address,
    topics: topics as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockHash: `0x${"ab".repeat(32)}`,
    blockNumber: 36_723_000n,
    logIndex: logIndex++,
    transactionHash: `0x${"cd".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

function transferLog(): Log {
  const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  const topics = encodeEventTopics({
    abi: erc20,
    eventName: "Transfer",
    args: { from: "0x0000000000000000000000000000000000000000", to: USER },
  });
  return { ...shareLog("Delegated", USER, 0n), topics: topics as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: "uint256" }], [5n * E18]) };
}

describe("decodeShareEvents", () => {
  it("sums Delegated + ClaimedRewards from a 1-tx compound receipt", () => {
    const logs = [shareLog("ClaimedRewards", USER, 3n * E18), shareLog("Delegated", USER, 3n * E18)];
    expect(decodeShareEvents(logs, SHARE, USER)).toEqual({ delegatedWei: 3n * E18, undelegatedWei: 0n, claimedWei: 3n * E18 });
  });

  it("decodes Undelegated (with auto-claim)", () => {
    const logs = [shareLog("ClaimedRewards", USER, 1n), shareLog("Undelegated", USER, 100n * E18)];
    expect(decodeShareEvents(logs, SHARE, USER)).toEqual({ delegatedWei: 0n, undelegatedWei: 100n * E18, claimedWei: 1n });
  });

  it("ignores logs from other shares, other users and non-ABI events (KAP20 Transfer)", () => {
    const logs = [
      shareLog("Delegated", USER, 7n, OTHER_SHARE),
      shareLog("ClaimedRewards", OTHER_USER, 9n),
      transferLog(),
      shareLog("Delegated", USER, 2n * E18),
    ];
    expect(decodeShareEvents(logs, SHARE, USER)).toEqual({ delegatedWei: 2n * E18, undelegatedWei: 0n, claimedWei: 0n });
  });

  it("compares addresses case-insensitively", () => {
    const logs = [shareLog("ClaimedRewards", USER, 5n)];
    const checksummedShare = "0x89A587d40bE5b1FE8C9d052C0bcda1a48C10Fa20" as Address;
    expect(decodeShareEvents(logs, checksummedShare, USER.toUpperCase().replace("0X", "0x") as Address).claimedWei).toBe(5n);
  });

  it("empty logs → zeros", () => {
    expect(decodeShareEvents([], SHARE, USER)).toEqual({ delegatedWei: 0n, undelegatedWei: 0n, claimedWei: 0n });
  });
});

describe("explorer URLs", () => {
  it("builds kubscan links and tolerates trailing slashes", () => {
    expect(explorerTxUrl("https://www.kubscan.com", "0xabc")).toBe("https://www.kubscan.com/tx/0xabc");
    expect(explorerTxUrl("https://www.kubscan.com/", "0xabc")).toBe("https://www.kubscan.com/tx/0xabc");
    expect(explorerAddressUrl("https://www.kubscan.com", SHARE)).toBe(`https://www.kubscan.com/address/${SHARE}`);
  });
});
