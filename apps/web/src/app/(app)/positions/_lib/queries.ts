import "server-only";
import {
  actions,
  getPositionWithRelations,
  getSettings,
  positions,
  positionSnapshots,
  txs,
  validators,
  walletPublicColumns,
  wallets,
  type ActionRow,
  type SettingsRow,
  type TxRow,
} from "@kubstake/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";

// Read helpers for the position pages + dashboard. Wallet rows are always selected WITHOUT encrypted_key.

export const OPEN_ACTION_STATUSES = ["pending", "running"] as const;

/** app_settings row, or null if it does not exist yet (other DB errors still throw). */
export async function getSettingsOrNull(): Promise<SettingsRow | null> {
  try {
    return await getSettings(getDb());
  } catch (err) {
    if (err instanceof Error && err.message.includes("app_settings row is missing")) return null;
    throw err;
  }
}

/** Action types that are still pending/running for a position (buttons of those types are disabled). */
export async function getOpenActionTypes(positionId: string): Promise<Set<ActionRow["type"]>> {
  const rows = await getDb()
    .select({ type: actions.type })
    .from(actions)
    .where(and(eq(actions.positionId, positionId), inArray(actions.status, OPEN_ACTION_STATUSES)));
  return new Set(rows.map((r) => r.type));
}

/** Tx columns shown in the history table (no signed_raw). */
const txListColumns = {
  id: txs.id,
  kind: txs.kind,
  status: txs.status,
  hash: txs.hash,
  nonce: txs.nonce,
  valueWei: txs.valueWei,
  gasPriceWei: txs.gasPriceWei,
  gasUsed: txs.gasUsed,
  blockNumber: txs.blockNumber,
  eventDelegatedWei: txs.eventDelegatedWei,
  eventUndelegatedWei: txs.eventUndelegatedWei,
  eventClaimedWei: txs.eventClaimedWei,
  error: txs.error,
  broadcastAt: txs.broadcastAt,
  confirmedAt: txs.confirmedAt,
  createdAt: txs.createdAt,
} as const;

export type TxListRow = Pick<TxRow, keyof typeof txListColumns>;

export async function loadPositionDetail(id: string) {
  const db = getDb();
  const position = await getPositionWithRelations(db, id);
  if (!position) return null;
  const [settings, openTypes, recentActions, recentTxs, snapshots] = await Promise.all([
    getSettingsOrNull(),
    getOpenActionTypes(id),
    db.select().from(actions).where(eq(actions.positionId, id)).orderBy(desc(actions.createdAt)).limit(20),
    db.select(txListColumns).from(txs).where(eq(txs.positionId, id)).orderBy(desc(txs.createdAt)).limit(30),
    db
      .select()
      .from(positionSnapshots)
      .where(eq(positionSnapshots.positionId, id))
      .orderBy(desc(positionSnapshots.takenAt))
      .limit(30),
  ]);
  return { position, settings, openTypes, recentActions, recentTxs, snapshots };
}

export async function loadDashboard() {
  const db = getDb();
  const [allPositions, allWallets, settings] = await Promise.all([
    db.query.positions.findMany({
      with: { wallet: { columns: { encryptedKey: false } }, validator: true },
      orderBy: [asc(positions.createdAt)],
    }),
    db.select(walletPublicColumns).from(wallets).orderBy(asc(wallets.createdAt)),
    getSettingsOrNull(),
  ]);
  return { positions: allPositions, wallets: allWallets, settings };
}

export async function loadNewPositionOptions() {
  const db = getDb();
  const [walletRows, validatorRows, existing, settings] = await Promise.all([
    db.select(walletPublicColumns).from(wallets).orderBy(asc(wallets.createdAt)),
    db.select().from(validators).orderBy(desc(validators.delegatedWei), asc(validators.validatorId)),
    db.select({ id: positions.id, walletId: positions.walletId, validatorId: positions.validatorId }).from(positions),
    getSettingsOrNull(),
  ]);
  return { wallets: walletRows, validators: validatorRows, existing, settings };
}
