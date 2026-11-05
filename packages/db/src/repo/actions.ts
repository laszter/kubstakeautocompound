import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { ACTION_STATUSES, ACTION_TYPES, actions, type ActionRequester } from "../schema";

export type ActionType = (typeof ACTION_TYPES)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export type EnqueueActionInput = {
  type: ActionType;
  positionId?: string | null;
  amountWei?: bigint | null;
  requestedBy?: ActionRequester;
};

/** Statuses that count as "already queued" for idempotency. */
const OPEN_STATUSES = ["pending", "running"] as const satisfies readonly ActionStatus[];

/**
 * First key of the two-int4 advisory lock used to serialize enqueues per (type, position).
 * The two-key space never overlaps the single-bigint key space used by the worker leader/migrate locks.
 */
const ENQUEUE_LOCK_CLASS = 0x6b750001;

/**
 * Queues an action for the worker. Idempotent: if an action of the same `type` for the same position
 * (or with no position, e.g. `sync_validators`) is still `pending`/`running`, its id is returned instead
 * and `created` is `false`. Concurrent calls are serialized with a transaction-scoped advisory lock.
 */
export async function enqueueAction(db: DbExecutor, a: EnqueueActionInput): Promise<{ id: string; created: boolean }> {
  const positionId = a.positionId ?? null;
  const amountWei = a.amountWei ?? null;
  assertValidAction(a.type, positionId, amountWei);

  return db.transaction(async (tx) => {
    const lockKey = `${a.type}:${positionId ?? "-"}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(String(ENQUEUE_LOCK_CLASS))}, hashtext(${lockKey}))`);

    const [existing] = await tx
      .select({ id: actions.id })
      .from(actions)
      .where(
        and(
          eq(actions.type, a.type),
          positionId === null ? isNull(actions.positionId) : eq(actions.positionId, positionId),
          inArray(actions.status, OPEN_STATUSES),
        ),
      )
      .orderBy(asc(actions.createdAt))
      .limit(1);
    if (existing) return { id: existing.id, created: false };

    const [row] = await tx
      .insert(actions)
      .values({ type: a.type, positionId, amountWei, requestedBy: a.requestedBy ?? "ui" })
      .returning({ id: actions.id });
    if (!row) throw new Error("enqueueAction: insert returned no row");
    return { id: row.id, created: true };
  });
}

function assertValidAction(type: ActionType, positionId: string | null, amountWei: bigint | null): void {
  if (!(ACTION_TYPES as readonly string[]).includes(type)) {
    throw new Error(`enqueueAction: unknown action type '${String(type)}'`);
  }
  if (type === "sync_validators") {
    if (positionId !== null) throw new Error("enqueueAction: sync_validators must not have a positionId");
    return;
  }
  if (positionId === null) throw new Error(`enqueueAction: ${type} requires a positionId`);
  if ((type === "delegate" || type === "undelegate") && (amountWei === null || amountWei <= 0n)) {
    throw new Error(`enqueueAction: ${type} requires amountWei > 0`);
  }
}
