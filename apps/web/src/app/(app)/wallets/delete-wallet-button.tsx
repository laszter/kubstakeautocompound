"use client";

import { Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionMessage } from "@/components/action-message";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteWallet } from "./actions";
import { DELETE_CONFIRM_WORD, type DeleteWalletState } from "./wallet-fields";

type Props = {
  walletId: string;
  label: string;
  address: string;
  positionCount: number;
  /** a position still has principal or unclaimed reward → the user must type DELETE (server re-checks) */
  needsConfirm: boolean;
  /** pre-formatted (formatKub) total principal of this wallet's positions */
  stakedKub: string;
  /** pre-formatted (formatKub) total unclaimed reward of this wallet's positions */
  pendingKub: string;
};

/** "ลบ" button + confirm dialog for one wallet row. */
export function DeleteWalletButton(props: Props) {
  const [open, setOpen] = useState(false);
  // Remount the dialog body on every open so the previous result / typed confirmation don't linger.
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setSession((n) => n + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2Icon />
        ลบ
      </DialogTrigger>
      <DialogContent className="md:max-w-md">
        <DeleteWalletBody key={session} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteWalletBody({ walletId, label, address, positionCount, needsConfirm, stakedKub, pendingKub }: Props) {
  const [state, formAction] = useActionState<DeleteWalletState | null, FormData>(deleteWallet, null);
  const [typed, setTyped] = useState("");
  // The server may ask for confirmation even if the page didn't know yet (stake arrived since render).
  const askConfirm = needsConfirm || Boolean(state && !state.ok && state.fieldErrors?.confirm);
  const confirmed = !askConfirm || typed.trim() === DELETE_CONFIRM_WORD;

  return (
    <>
      <DialogHeader>
        <DialogTitle>ลบ wallet &quot;{label}&quot;?</DialogTitle>
        <DialogDescription className="font-mono text-xs break-all">{address}</DialogDescription>
      </DialogHeader>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="walletId" value={walletId} />

        <p className="text-sm">
          ระบบจะลบ private key (ที่เข้ารหัสไว้){positionCount > 0 ? `, ${positionCount} position` : ""} และประวัติคำสั่ง/ธุรกรรมของ
          wallet นี้ออกจากฐานข้อมูล — เงินบน chain ไม่ถูกแตะ แต่ระบบจะ auto-compound หรือถอนให้ไม่ได้อีก
        </p>

        {askConfirm ? (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-foreground">
            <p className="flex gap-2 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                wallet นี้ยังมี KUB อยู่ใน position: stake <strong className="tabular-nums">{stakedKub} KUB</strong> · reward ค้าง{" "}
                <strong className="tabular-nums">{pendingKub} KUB</strong> — ถ้าลบ คุณต้องมี backup private key เองเพื่อถอน/claim
                ภายหลัง
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`confirm-${walletId}`}>
                พิมพ์ <code className="font-mono font-semibold">{DELETE_CONFIRM_WORD}</code> เพื่อยืนยัน
              </Label>
              <Input
                id={`confirm-${walletId}`}
                name="confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="bg-card font-mono"
              />
            </div>
          </div>
        ) : null}

        <ActionMessage state={state} />

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>ยกเลิก</DialogClose>
          <SubmitButton variant="destructive" disabled={!confirmed} pendingText="กำลังลบ...">
            <Trash2Icon />
            ลบ wallet
          </SubmitButton>
        </DialogFooter>
      </form>
    </>
  );
}
