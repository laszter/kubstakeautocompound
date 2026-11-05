import { describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "../client";
import { enqueueAction } from "./actions";

/** A db whose every use fails the test — the guards must reject before touching it. */
function untouchableDb(): DbExecutor {
  const transaction = vi.fn(() => {
    throw new Error("db must not be used");
  });
  return { transaction } as unknown as DbExecutor;
}

describe("enqueueAction input guards", () => {
  const pos = "00000000-0000-4000-8000-000000000001";

  it.each([
    [{ type: "delegate", positionId: null, amountWei: 1n }, /requires a positionId/],
    [{ type: "claim" }, /requires a positionId/],
    [{ type: "delegate", positionId: pos }, /amountWei > 0/],
    [{ type: "undelegate", positionId: pos, amountWei: 0n }, /amountWei > 0/],
    [{ type: "sync_validators", positionId: pos }, /must not have a positionId/],
    [{ type: "bogus", positionId: pos }, /unknown action type/],
  ] as const)("rejects %o", async (input, msg) => {
    const db = untouchableDb();
    await expect(enqueueAction(db, input as Parameters<typeof enqueueAction>[1])).rejects.toThrow(msg);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("valid input reaches the transaction", async () => {
    const db = untouchableDb();
    await expect(enqueueAction(db, { type: "claim", positionId: pos })).rejects.toThrow("db must not be used");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
