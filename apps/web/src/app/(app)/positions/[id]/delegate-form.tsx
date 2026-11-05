"use client";

import { startTransition, useActionState, useState } from "react";
import { ActionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AmountFormState } from "../_lib/position-fields";
import { enqueueDelegate } from "./actions";

type Props = {
  positionId: string;
  /** non-null → form disabled with this explanation */
  disabledReason: string | null;
  /** max amount (full precision, for the "สูงสุด" button); null = balance unknown */
  maxKub: string | null;
  maxLabel: string | null;
  /** minDelegated, shown when the position has no principal yet */
  minFirstLabel: string | null;
  reserveLabel: string;
};

export function DelegateForm({ positionId, disabledReason, maxKub, maxLabel, minFirstLabel, reserveLabel }: Props) {
  const [state, dispatch, isPending] = useActionState<AmountFormState | null, FormData>(
    enqueueDelegate.bind(null, positionId),
    null,
  );
  const [amount, setAmount] = useState("");
  const disabled = disabledReason !== null;
  // The amount sent with the last submit — its error is hidden once the user edits the input.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const error = state && !state.ok && amount === submitted ? state.fieldErrors?.amountKub : undefined;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("amountKub", amount);
    setSubmitted(amount);
    startTransition(() => dispatch(fd));
  }

  // Clear the input after a successful enqueue (the action returns an empty amount on success).
  const [seen, setSeen] = useState<AmountFormState | null>(null);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setAmount("");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <Label htmlFor="delegate-amount">Delegate เพิ่ม (KUB)</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="delegate-amount"
          name="amountKub"
          inputMode="decimal"
          autoComplete="off"
          placeholder="เช่น 100"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby="delegate-hint"
          className="min-w-32 flex-1"
        />
        {maxKub !== null ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={() => setAmount(maxKub)}>
            สูงสุด
          </Button>
        ) : null}
        <Button type="submit" disabled={disabled || isPending}>
          {isPending ? "กำลังส่ง..." : "Delegate"}
        </Button>
      </div>
      <p id="delegate-hint" className={error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
        {error ??
          (disabledReason ??
            [
              maxLabel !== null ? `ใช้ได้สูงสุด ≈ ${maxLabel} KUB` : "ยังไม่ทราบยอดคงเหลือ (รอ worker)",
              `(กัน gas reserve ${reserveLabel} KUB + ค่า gas)`,
              minFirstLabel ? `· ครั้งแรกต้อง ≥ minDelegated ${minFirstLabel} KUB` : null,
            ]
              .filter(Boolean)
              .join(" "))}
      </p>
      <ActionMessage state={state?.ok || amount === submitted ? state : null} />
    </form>
  );
}
