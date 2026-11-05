import { getAddress } from "viem";

/**
 * KUB Mainnet (chainId 96) contract addresses — verified on-chain 2026-11-04 (RECON §1).
 * Checksummed via viem `getAddress` (pure computation, no side effects).
 */
export const ADDRESSES = {
  /** StakeManagerV2 (not a proxy). */
  stakeManager: getAddress("0x443502b3F7C0934576F49CDa084f78640f56A80F"),
  /** StakeManagerStorage (V2) — validator list / info. */
  stakeManagerStorage: getAddress("0xfd98aac1fbc57e6bc16a167452dba7af2b6a4c0d"),
  /** StakeManagerVault — pays KUB out (internal transfer). */
  stakeManagerVault: getAddress("0xcf726f7fe91d0f2373904d350b926830784e810c"),
  stakingNft: getAddress("0x8ae4cb6a020121bcbd855fffc79a11984be62b39"),
  validatorShareFactory: getAddress("0x275d0cf1384b782db4212e074f147de9b7b2e6b2"),
} as const;

export const EXPLORER_URL_DEFAULT = "https://www.kubscan.com";
export const RPC_URL_DEFAULT = "https://rpc.kubchain.io";
export const SUBGRAPH_URL_DEFAULT = "https://gateway.bitkubgraph.io/subgraphs/name/bitkubchain/pos";
