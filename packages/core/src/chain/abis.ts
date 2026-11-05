import { parseAbi } from "viem";

// Minimal ABIs copied verbatim from RECON §1 "Minimal viem ABI".
// Do NOT add the onlyCallHelper overloads delegate(uint256,address) / undelegate(uint256,address) /
// claimRewards(address): they revert for EOAs and make viem overload resolution ambiguous.

export const stakeManagerStorageAbi = parseAbi([
  "struct Validator { uint128 amount; uint128 delegatedAmount; uint128 reward; uint128 delegatorsReward; uint128 infraCommissionAmount; uint128 validatorCommissionAmount; uint128 delegatorCommissionAmount; uint128 minDeposit; address signer; address validatorShareContract; uint8 status; uint16 infraCommissionRate; uint16 commissionRate; }",
  "function getValidatorInfoByIndex(uint256 index_) view returns (Validator)",
  "function getValidatorListLength() view returns (uint256)",
  "function isInMinimalValidatorListByValidatorId(uint256 validatorId_) view returns (bool)",
  "function minimumPoolDelegate() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
]);

export const stakeManagerAbi = parseAbi([
  "function getValidators() view returns (address[])",
  "function getMinimalValidators() view returns ((address signer, uint256 power)[])",
  "function stakeManagerStorage() view returns (address)",
]);

export const validatorShareAbi = parseAbi([
  "function delegate() payable returns (uint256)",
  "function undelegate(uint256 claimAmount_) returns (uint256)",
  "function claimRewards() returns (uint256)",
  "function getLiquidRewards(address user_) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function validatorId() view returns (uint256)",
  "function delegation() view returns (bool)",
  "function minDelegated() view returns (uint256)",
  "function isOfficialPool() view returns (bool)",
  "function paused() view returns (bool)",
  "event Delegated(uint256 indexed validatorId, address indexed user, uint256 amount)",
  "event Undelegated(uint256 indexed validatorId, address indexed user, uint256 amount)",
  "event ClaimedRewards(uint256 indexed validatorId, address indexed user, uint256 amount)",
]);
