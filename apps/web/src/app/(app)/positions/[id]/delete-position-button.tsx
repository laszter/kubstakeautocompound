"use client";

import { Trash2Icon } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { ActionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action-result";
import { deletePosition } from "./actions";

/** Deletes the position (server re-checks principal = 0 && pending = 0 && no open action). */
export function DeletePositionButton({ positionId, disabledReason }: { positionId: string; disabledReason: string | null }) {
  const [state, dispatch, isPending] = useActionState<ActionResult | null>(deletePosition.bind(null, positionId), null);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="destructive"
          disabled={disabledReason !== null || isPending}
          onClick={() => setOpen(true)}
        >
          <Trash2Icon />
          {isPending ? "กำลังลบ..." : "ลบ position"}
        </Button>
        <span className="text-muted-foreground text-xs">
          {disabledReason ?? "เงินต้นและ reward เป็น 0 แล้ว — ลบออกจากระบบได้ (ประวัติ action/snapshot ของ position นี้จะถูกลบด้วย)"}
        </span>
      </div>
      <ActionMessage state={state} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบ position นี้?</DialogTitle>
            <DialogDescription>
              ลบการตั้งค่า auto-compound, ประวัติคำสั่ง และ snapshots ของ position นี้ (ประวัติ tx ยังเก็บไว้ใต้ wallet) —
              ไม่มีผลกับ chain
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>ยกเลิก</DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setOpen(false);
                startTransition(() => dispatch());
              }}
            >
              ยืนยันลบ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
