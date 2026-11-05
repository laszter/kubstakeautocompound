"use client";

import { RefreshCwIcon, HandCoinsIcon } from "lucide-react";
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
import { enqueueClaim, enqueueCompoundNow } from "./actions";

type Props = {
  positionId: string;
  claimDisabledReason: string | null;
  compoundDisabledReason: string | null;
  pendingLabel: string;
  costLabel: string;
  pathLabel: string;
};

export function ActionButtons({
  positionId,
  claimDisabledReason,
  compoundDisabledReason,
  pendingLabel,
  costLabel,
  pathLabel,
}: Props) {
  const [claimState, claim, claimPending] = useActionState<ActionResult | null>(enqueueClaim.bind(null, positionId), null);
  const [compoundState, compound, compoundPending] = useActionState<ActionResult | null>(
    enqueueCompoundNow.bind(null, positionId),
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  function onConfirmCompound() {
    setConfirmOpen(false);
    startTransition(() => compound());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            disabled={claimDisabledReason !== null || claimPending}
            onClick={() => startTransition(() => claim())}
          >
            <HandCoinsIcon />
            {claimPending ? "กำลังส่ง..." : "Claim reward"}
          </Button>
          <p className="text-muted-foreground text-xs">
            {claimDisabledReason ?? `โอน reward ที่ค้าง (≈ ${pendingLabel} KUB) เข้า wallet โดยไม่ stake กลับ`}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            disabled={compoundDisabledReason !== null || compoundPending}
            onClick={() => setConfirmOpen(true)}
          >
            <RefreshCwIcon />
            {compoundPending ? "กำลังส่ง..." : "Compound ตอนนี้"}
          </Button>
          <p className="text-muted-foreground text-xs">
            {compoundDisabledReason ?? "claim แล้ว delegate กลับทันที โดยไม่รอเกณฑ์ของ mode"}
          </p>
        </div>
      </div>
      <ActionMessage state={claimState} />
      <ActionMessage state={compoundState} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compound ตอนนี้?</DialogTitle>
            <DialogDescription>
              worker จะ compound reward ที่ค้าง (≈ {pendingLabel} KUB) ทันที — ไม่สน threshold / schedule / min interval / max gas
              price ของ mode แต่ยังกัน gas reserve และ simulate ก่อนส่งเสมอ
            </DialogDescription>
          </DialogHeader>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            <li>path ที่คาดว่าจะใช้: {pathLabel}</li>
            <li>ค่า gas โดยประมาณ ≈ {costLabel} KUB</li>
          </ul>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>ยกเลิก</DialogClose>
            <Button type="button" onClick={onConfirmCompound}>
              ยืนยัน compound
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
