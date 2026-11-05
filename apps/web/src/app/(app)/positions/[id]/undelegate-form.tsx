"use client";

import { formatKub, parseKub } from "@kubstake/core/browser";
import { TriangleAlertIcon } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { ActionMessage } from "@/components/action-message";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AmountFormState } from "../_lib/position-fields";
import { enqueueUndelegate } from "./actions";

type Props = {
  positionId: string;
  disabledReason: string | null;
  /** wei as decimal strings (bigint can't cross the RSC boundary) */
  principalWei: string;
  minDelegatedWei: string;
  principalLabel: string;
  minDelegatedLabel: string;
  pendingLabel: string;
};

function tryParseKub(s: string): bigint | null {
  try {
    return s.trim() ? parseKub(s) : null;
  } catch {
    return null;
  }
}

export function UndelegateForm({
  positionId,
  disabledReason,
  principalWei,
  minDelegatedWei,
  principalLabel,
  minDelegatedLabel,
  pendingLabel,
}: Props) {
  const [state, dispatch, isPending] = useActionState<AmountFormState | null, FormData>(
    enqueueUndelegate.bind(null, positionId),
    null,
  );
  const [amount, setAmount] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const disabled = disabledReason !== null;
  // The amount sent with the last submit — its error is hidden once the user edits the input.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const error = state && !state.ok && amount === submitted ? state.fieldErrors?.amountKub : undefined;

  const [seen, setSeen] = useState<AmountFormState | null>(null);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setAmount("");
  }

  const principal = BigInt(principalWei);
  const minDelegated = BigInt(minDelegatedWei);
  const typed = tryParseKub(amount);
  const rest = typed !== null && typed <= principal ? principal - typed : null;
  const willExitFully = rest !== null && rest > 0n && rest < minDelegated;
  const tooMuch = typed !== null && typed > principal;

  const warning = `ถ้าเหลือต่ำกว่า minDelegated (${minDelegatedLabel} KUB) ระบบจะถอนทั้งหมด`;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("amountKub", amount);
    setSubmitted(amount);
    startTransition(() => dispatch(fd));
  }

  function onConfirmAll() {
    setConfirmAll(false);
    const fd = new FormData();
    fd.set("all", "true");
    setSubmitted(amount);
    startTransition(() => dispatch(fd));
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
        <Label htmlFor="undelegate-amount">ถอน (undelegate) KUB</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="undelegate-amount"
            name="amountKub"
            inputMode="decimal"
            autoComplete="off"
            placeholder={`สูงสุด ${principalLabel}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled}
            aria-invalid={error || tooMuch ? true : undefined}
            aria-describedby="undelegate-hint"
            className="min-w-32 flex-1"
          />
          <Button type="submit" variant="outline" disabled={disabled || isPending}>
            {isPending ? "กำลังส่ง..." : "ถอน"}
          </Button>
          <Button type="button" variant="destructive" disabled={disabled || isPending} onClick={() => setConfirmAll(true)}>
            ถอนทั้งหมด
          </Button>
        </div>
        <p id="undelegate-hint" className={error || tooMuch ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {error ??
            (tooMuch
              ? `ถอนได้ไม่เกินเงินต้น ${principalLabel} KUB`
              : (disabledReason ?? `เงินต้น ${principalLabel} KUB · การถอนจะ claim reward ที่ค้าง (≈ ${pendingLabel} KUB) ให้อัตโนมัติ · ไม่มี unbonding`))}
        </p>
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            {willExitFully ? (
              <>
                <strong>จะถอนทั้งหมด:</strong> เหลือ {formatKub(rest as bigint)} KUB ซึ่งต่ำกว่า minDelegated ({minDelegatedLabel}{" "}
                KUB) — contract จะถอนทั้งหมด {principalLabel} KUB
              </>
            ) : (
              warning
            )}
          </AlertDescription>
        </Alert>
        <ActionMessage state={state?.ok || amount === submitted ? state : null} />
      </form>

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ถอนทั้งหมด {principalLabel} KUB?</DialogTitle>
            <DialogDescription>
              worker จะเรียก undelegate ด้วยเงินต้นทั้งหมด — reward ที่ค้าง (≈ {pendingLabel} KUB) จะถูก claim ให้อัตโนมัติใน
              tx เดียวกัน และ KUB จะกลับเข้า wallet ทันที (ไม่มี unbonding)
            </DialogDescription>
          </DialogHeader>
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>ยกเลิก</DialogClose>
            <Button type="button" variant="destructive" onClick={onConfirmAll}>
              ยืนยันถอนทั้งหมด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
