"use server";

import "server-only";
import { deriveAddress, encryptPrivateKey, normalizePrivateKey, parseMasterKey } from "@kubstake/core";
import { actions, positions, txs, wallets } from "@kubstake/db";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromZodError, ok } from "@/lib/action-result";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { safeErrorCode } from "@/lib/safe-error";
import {
  DELETE_CONFIRM_WORD,
  PRIVATE_KEY_INPUT_MAX,
  WALLET_LABEL_MAX,
  type AddWalletState,
  type AddWalletValues,
  type DeleteWalletState,
} from "./wallet-fields";

// Security: the private key only ever arrives here inside FormData (next dev logs plain action args), is
// encrypted immediately and is never returned, logged or echoed in an error message. Errors from the DB
// insert are logged by code only — drizzle's DrizzleQueryError message embeds the query params (ciphertext).

const PK_INVALID = "private key ไม่ถูกต้อง — ต้องเป็น hex 64 ตัว (มีหรือไม่มี 0x นำหน้าก็ได้)";

const addWalletSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "กรุณาตั้งชื่อ wallet")
    .max(WALLET_LABEL_MAX, `ชื่อยาวได้ไม่เกิน ${WALLET_LABEL_MAX} ตัวอักษร`)
    .regex(/^[^\p{Cc}]*$/u, "ชื่อมีตัวอักษรควบคุมที่ใช้ไม่ได้"),
  privateKey: z.string().min(1, "กรุณาใส่ private key").max(PRIVATE_KEY_INPUT_MAX, PK_INVALID),
});

function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * useActionState action of the add-wallet form: requireSession → zod → normalizePrivateKey → deriveAddress →
 * encryptPrivateKey(MASTER_KEY, pk, address.toLowerCase()) → insert. Returns the label only (never key/ciphertext).
 */
export async function addWallet(_prev: AddWalletState | null, formData: FormData): Promise<AddWalletState> {
  await requireSession();

  const values: AddWalletValues = { label: formString(formData, "label").slice(0, WALLET_LABEL_MAX * 2) };
  const parsed = addWalletSchema.safeParse({ label: values.label, privateKey: formString(formData, "privateKey") });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  const { label } = parsed.data;

  let address: string;
  let encryptedKey: string;
  try {
    const pk = normalizePrivateKey(parsed.data.privateKey);
    address = deriveAddress(pk);
    try {
      encryptedKey = encryptPrivateKey(parseMasterKey(env.MASTER_KEY), pk, address.toLowerCase());
    } catch (err) {
      console.error(`[wallets] encryptPrivateKey failed (${err instanceof Error ? err.name : typeof err}) — check MASTER_KEY`);
      return { ...fail("เข้ารหัส private key ไม่สำเร็จ: ตรวจค่า MASTER_KEY ของ web — ดู log"), values };
    }
  } catch {
    return { ...fail(PK_INVALID, { privateKey: PK_INVALID }), values };
  }

  let inserted: { id: string }[];
  try {
    inserted = await getDb()
      .insert(wallets)
      .values({ label, address, encryptedKey })
      .onConflictDoNothing({ target: wallets.address })
      .returning({ id: wallets.id });
  } catch (err) {
    console.error(`[wallets] insert failed (${safeErrorCode(err)})`);
    return { ...fail("บันทึก wallet ไม่สำเร็จ: ฐานข้อมูลไม่พร้อม — ดู log ของ web"), values };
  }

  if (inserted.length === 0) {
    const msg = `มี wallet นี้แล้ว (${address})`;
    return { ...fail(msg, { privateKey: msg }), values };
  }

  revalidatePath("/wallets");
  return {
    ok: true,
    message: `เพิ่ม wallet "${label}" แล้ว — address ${address} · worker จะอ่าน balance ให้ในรอบถัดไป`,
    values: { label: "" },
  };
}

const walletIdSchema = z.uuid();

/**
 * Delete-wallet dialog action. Blocked while the worker is running an action / has a tx in flight for the
 * wallet; requires `confirm === "DELETE"` when a position still has principal (or unclaimed reward).
 * Cascades to positions, actions, snapshots and txs (FK on delete cascade).
 */
export async function deleteWallet(_prev: DeleteWalletState | null, formData: FormData): Promise<DeleteWalletState> {
  await requireSession();

  const walletId = formString(formData, "walletId");
  const confirm = formString(formData, "confirm").trim();
  if (!walletIdSchema.safeParse(walletId).success) return fail("ไม่พบ wallet นี้");

  type Outcome =
    | { kind: "not_found" }
    | { kind: "busy" }
    | { kind: "needs_confirm"; funded: number }
    | { kind: "deleted"; label: string };

  let outcome: Outcome;
  try {
    outcome = await getDb().transaction(async (tx): Promise<Outcome> => {
      const [wallet] = await tx
        .select({ id: wallets.id, label: wallets.label })
        .from(wallets)
        .where(eq(wallets.id, walletId))
        .for("update");
      if (!wallet) return { kind: "not_found" };

      const [running] = await tx
        .select({ n: count() })
        .from(actions)
        .innerJoin(positions, eq(actions.positionId, positions.id))
        .where(and(eq(positions.walletId, walletId), eq(actions.status, "running")));
      const [inFlight] = await tx
        .select({ n: count() })
        .from(txs)
        .where(and(eq(txs.walletId, walletId), inArray(txs.status, ["signed", "broadcast"])));
      if ((running?.n ?? 0) > 0 || (inFlight?.n ?? 0) > 0) return { kind: "busy" };

      const [funded] = await tx
        .select({ n: count() })
        .from(positions)
        .where(
          and(eq(positions.walletId, walletId), sql`(${positions.principalWei} > 0 or ${positions.pendingWei} > 0)`),
        );
      const fundedCount = funded?.n ?? 0;
      if (fundedCount > 0 && confirm !== DELETE_CONFIRM_WORD) return { kind: "needs_confirm", funded: fundedCount };

      await tx.delete(wallets).where(eq(wallets.id, walletId));
      return { kind: "deleted", label: wallet.label };
    });
  } catch (err) {
    console.error(`[wallets] delete failed (${safeErrorCode(err)})`);
    return fail("ลบ wallet ไม่สำเร็จ: ฐานข้อมูลไม่พร้อม — ดู log ของ web");
  }

  switch (outcome.kind) {
    case "not_found":
      revalidatePath("/wallets");
      return fail("ไม่พบ wallet นี้ (อาจถูกลบไปแล้ว)");
    case "busy":
      return fail("wallet นี้มีคำสั่งหรือธุรกรรมที่ worker กำลังทำอยู่ — รอให้เสร็จก่อนแล้วค่อยลบ");
    case "needs_confirm": {
      const msg = `wallet นี้ยังมี KUB stake หรือ reward ค้างอยู่ใน ${outcome.funded} position — พิมพ์ ${DELETE_CONFIRM_WORD} เพื่อยืนยันการลบ`;
      return fail(msg, { confirm: msg });
    }
    case "deleted":
      revalidatePath("/wallets");
      return ok(`ลบ wallet "${outcome.label}" แล้ว`);
  }
}
