"use server";

import { enqueueAction } from "@kubstake/db";
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * "รีเฟรชรายชื่อ": queues a `sync_validators` action for the worker (web never calls RPC). Idempotent —
 * if a sync is already pending/running, nothing new is queued. Takes no input, so it can be passed straight
 * to useActionState (the extra state/FormData args are ignored).
 */
export async function requestValidatorSync(): Promise<ActionResult> {
  await requireSession();

  try {
    const { created } = await enqueueAction(getDb(), { type: "sync_validators", requestedBy: "ui" });
    revalidatePath("/validators");
    return ok(
      created
        ? "ส่งคำสั่งซิงก์แล้ว — worker จะดึงรายชื่อ validator ใหม่จาก chain ในรอบถัดไป"
        : "มีคำสั่งซิงก์ค้างอยู่แล้ว — รอ worker ทำให้เสร็จ",
    );
  } catch (err) {
    console.error(`[validators] enqueue sync_validators failed: ${err instanceof Error ? err.message : String(err)}`);
    return fail("ส่งคำสั่งซิงก์ไม่สำเร็จ: ฐานข้อมูลไม่พร้อม — ดู log ของ web");
  }
}
