"use client";

import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { ActionMessage } from "@/components/action-message";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { NewPositionState, NewPositionValues } from "../_lib/position-fields";
import { createPosition } from "./actions";

export type WalletOption = {
  id: string;
  label: string;
  address: string;
  balanceLabel: string | null;
  maxLabel: string | null;
};

export type ValidatorOption = {
  id: string;
  name: string;
  commissionLabel: string;
  minDelegatedLabel: string;
  delegatedLabel: string;
};

type Props = {
  wallets: WalletOption[];
  validators: ValidatorOption[];
  /** `${walletId}:${validatorId}` → existing position id */
  existing: Record<string, string>;
  initial: NewPositionValues;
  reserveLabel: string;
  workerFresh: boolean;
};

export function NewPositionForm({ wallets, validators, existing, initial, reserveLabel, workerFresh }: Props) {
  const [state, dispatch, isPending] = useActionState<NewPositionState | null, FormData>(createPosition, null);
  const [v, setV] = useState<NewPositionValues>(initial);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  const wallet = wallets.find((w) => w.id === v.walletId) ?? null;
  const validator = validators.find((x) => x.id === v.validatorId) ?? null;
  const existingId = wallet && validator ? existing[`${wallet.id}:${validator.id}`] : undefined;

  const walletItems = wallets.map((w) => ({ value: w.id, label: `${w.label} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` }));
  const validatorItems = validators.map((x) => ({ value: x.id, label: `${x.name} (#${x.id})` }));

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("walletId", v.walletId);
    fd.set("validatorId", v.validatorId);
    fd.set("amountKub", v.amountKub);
    startTransition(() => dispatch(fd));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="walletId">Wallet</Label>
        <Select
          items={walletItems}
          value={v.walletId || null}
          onValueChange={(id) => setV((p) => ({ ...p, walletId: id ? String(id) : "" }))}
        >
          <SelectTrigger id="walletId" className="w-full" aria-invalid={fieldErrors?.walletId ? true : undefined}>
            <SelectValue placeholder="เลือก wallet" />
          </SelectTrigger>
          <SelectContent>
            {walletItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className={fieldErrors?.walletId ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {fieldErrors?.walletId ??
            (wallet
              ? wallet.balanceLabel !== null
                ? `ยอดคงเหลือ ${wallet.balanceLabel} KUB · delegate ได้สูงสุด ≈ ${wallet.maxLabel} KUB (กัน gas reserve ${reserveLabel} KUB + ค่า gas)`
                : "ยังไม่ทราบยอดคงเหลือ — รอ worker อ่านยอด (ทุก tick)"
              : "wallet ที่จะใช้ delegate (เพิ่มได้ที่หน้ากระเป๋า)")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="validatorId">Validator (เฉพาะที่เปิดรับ delegate)</Label>
        <Select
          items={validatorItems}
          value={v.validatorId || null}
          onValueChange={(id) => setV((p) => ({ ...p, validatorId: id ? String(id) : "" }))}
        >
          <SelectTrigger id="validatorId" className="w-full" aria-invalid={fieldErrors?.validatorId ? true : undefined}>
            <SelectValue placeholder="เลือก validator" />
          </SelectTrigger>
          <SelectContent>
            {validatorItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className={fieldErrors?.validatorId ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {fieldErrors?.validatorId ??
            (validator
              ? `commission ${validator.commissionLabel} · minDelegated ${validator.minDelegatedLabel} KUB · delegated รวม ${validator.delegatedLabel} KUB`
              : "ไม่เห็น validator ที่ต้องการ? ไปหน้า Validators แล้วกดรีเฟรชรายชื่อ")}
        </p>
      </div>

      {existingId ? (
        <Alert variant="info">
          <InfoIcon />
          <AlertDescription>
            มี position ของ wallet × validator นี้อยู่แล้ว —{" "}
            <Link href={`/positions/${existingId}`} className="font-medium underline underline-offset-2">
              ไปหน้า position
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="amountKub">
          จำนวน KUB เริ่มต้น <span className="text-muted-foreground font-normal">(ไม่บังคับ)</span>
        </Label>
        <Input
          id="amountKub"
          inputMode="decimal"
          autoComplete="off"
          placeholder="เว้นว่าง = สร้าง position อย่างเดียว"
          value={v.amountKub}
          onChange={(e) => setV((p) => ({ ...p, amountKub: e.target.value }))}
          aria-invalid={fieldErrors?.amountKub ? true : undefined}
          aria-describedby="amountKub-hint"
        />
        <p id="amountKub-hint" className={fieldErrors?.amountKub ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {fieldErrors?.amountKub ??
            `ถ้าใส่: ต้อง ≥ minDelegated${validator ? ` (${validator.minDelegatedLabel} KUB)` : ""} และไม่เกินยอดที่ใช้ได้ — ระบบจะส่งคำสั่ง delegate ให้ worker${
              workerFresh ? "" : " (ตอนนี้ worker ไม่ตอบสนอง — เว้นว่างไว้ก่อน)"
            }`}
        </p>
      </div>

      <ActionMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "กำลังสร้าง..." : v.amountKub.trim() ? "สร้าง position + delegate" : "สร้าง position"}
        </Button>
        <Link href="/" className={buttonVariants({ variant: "ghost" })}>
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}
