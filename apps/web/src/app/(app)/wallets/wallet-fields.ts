import type { ActionResult } from "@/lib/action-result";

// Shared by the wallets page (server), its actions ("use server") and the client forms: pure, no server imports.

export const WALLET_LABEL_MAX = 64;
/** Upper bound on the raw private-key field (64 hex + "0x" + whitespace); anything longer is rejected unparsed. */
export const PRIVATE_KEY_INPUT_MAX = 200;
/** Word the user must type to delete a wallet that still has KUB staked / pending in a position. */
export const DELETE_CONFIRM_WORD = "DELETE";

/** Values echoed back after React resets the form. Never contains the private key. */
export type AddWalletValues = { label: string };
export type AddWalletState = ActionResult & { values?: AddWalletValues };

export type DeleteWalletState = ActionResult;
