"use client";

import { describeCron, validateCron } from "@kubstake/core/browser";
import { startTransition, useActionState, useMemo, useState } from "react";
import { ActionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DOW_LABELS,
  SCHEDULE_KIND_LABELS,
  SCHEDULE_KINDS,
  scheduleValuesToCron,
  SETTINGS_FORM_FIELDS,
  THRESHOLD_MIN_KUB,
  type PositionMode,
  type PositionSettingsField,
  type PositionSettingsState,
  type PositionSettingsValues,
} from "../_lib/position-fields";
import { updatePositionSettings } from "./actions";

export type SettingsHints = {
  hasPrincipal: boolean;
  /** R* with C of the expected path */
  rStarLabel: string;
  /** max(R*, R floor) */
  optimalTargetLabel: string;
  optimalEtaLabel: string;
  rFloorLabel: string;
  costLabel: string;
  /** 2 × C */
  defaultMinRewardLabel: string;
  aprLabel: string;
};

type Props = {
  positionId: string;
  initial: PositionSettingsValues;
  timeZone: string;
  hints: SettingsHints;
};

const KIND_ITEMS = SCHEDULE_KINDS.map((k) => ({ value: k, label: SCHEDULE_KIND_LABELS[k] }));
const DOW_ITEMS = DOW_LABELS.map((label, i) => ({ value: String(i), label: `วัน${label}` }));

type Preview = { ok: true; expr: string; description: string; runs: string[] } | { ok: false; error: string };

function schedulePreview(v: PositionSettingsValues, timeZone: string): Preview {
  const r = scheduleValuesToCron(v);
  if (!r.ok) return { ok: false, error: r.error };
  const check = validateCron(r.expr, timeZone);
  if (!check.ok) return { ok: false, error: check.error };
  const fmt = new Intl.DateTimeFormat("th-TH", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { ok: true, expr: r.expr, description: describeCron(r.expr), runs: check.nextRuns.slice(0, 3).map((d) => fmt.format(d)) };
}

function FieldHint({ id, error, children }: { id: string; error?: string; children: React.ReactNode }) {
  return (
    <p id={id} className={error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
      {error ?? children}
    </p>
  );
}

export function PositionSettingsForm({ positionId, initial, timeZone, hints }: Props) {
  const [state, dispatch, isPending] = useActionState<PositionSettingsState | null, FormData>(
    updatePositionSettings.bind(null, positionId),
    null,
  );
  const [v, setV] = useState<PositionSettingsValues>(initial);
  // Fields edited since the last submit hide their (now stale) server error.
  const [edited, setEdited] = useState<ReadonlySet<PositionSettingsField>>(new Set());
  const set = (k: PositionSettingsField) => (value: string) => {
    setV((prev) => ({ ...prev, [k]: value }));
    setEdited((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
  };
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (k: PositionSettingsField) => (edited.has(k) ? undefined : fieldErrors?.[k]);

  const preview = useMemo(
    () => (v.mode === "schedule" ? schedulePreview(v, timeZone) : null),
    [v, timeZone],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    for (const k of SETTINGS_FORM_FIELDS) fd.set(k, v[k]);
    setEdited(new Set());
    startTransition(() => dispatch(fd));
  }

  const rStarHint = hints.hasPrincipal
    ? `R* ของระบบ ≈ ${hints.rStarLabel} KUB · ถึงเกณฑ์ optimal (${hints.optimalTargetLabel} KUB) ${hints.optimalEtaLabel}`
    : "ยังไม่มีเงินต้น — R* จะคำนวณได้หลัง delegate";

  const modes: { value: PositionMode; title: string; description: string; hint: string }[] = [
    {
      value: "optimal",
      title: "Optimal (แนะนำ)",
      description: "ระบบคำนวณ reward ที่คุ้มค่า gas ที่สุดให้ แล้ว compound ทันทีเมื่อถึง — R* = √(2·C·P) และไม่ต่ำกว่า R floor",
      hint: hints.hasPrincipal
        ? `ตอนนี้: R* ≈ ${hints.rStarLabel} KUB (R floor ${hints.rFloorLabel}) → เกณฑ์ ${hints.optimalTargetLabel} KUB · ETA ${hints.optimalEtaLabel}`
        : rStarHint,
    },
    {
      value: "threshold",
      title: "Threshold",
      description: "compound เมื่อ reward ที่ค้าง ≥ จำนวน KUB ที่ตั้งเอง",
      hint: rStarHint,
    },
    {
      value: "schedule",
      title: "Schedule",
      description: `compound ตามเวลา (cron, เขตเวลา ${timeZone}) — ข้ามรอบถ้า reward ยังน้อยกว่าขั้นต่ำ`,
      hint: rStarHint,
    },
  ];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">โหมด trigger</legend>
        <RadioGroup value={v.mode} onValueChange={(m) => set("mode")(String(m))} className="gap-2" aria-label="โหมด trigger">
          {modes.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                v.mode === m.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <RadioGroupItem value={m.value} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{m.title}</span>
                <span className="text-muted-foreground text-xs">{m.description}</span>
                <span className="text-xs text-info">{m.hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {err("mode") ? <p className="text-destructive text-xs">{err("mode")}</p> : null}
      </fieldset>

      {v.mode === "threshold" ? (
        <div className="flex max-w-sm flex-col gap-1.5">
          <Label htmlFor="thresholdKub">
            Threshold <span className="text-muted-foreground font-normal">(KUB, ≥ {THRESHOLD_MIN_KUB})</span>
          </Label>
          <Input
            id="thresholdKub"
            inputMode="decimal"
            autoComplete="off"
            value={v.thresholdKub}
            onChange={(e) => set("thresholdKub")(e.target.value)}
            aria-invalid={err("thresholdKub") ? true : undefined}
            aria-describedby="thresholdKub-hint"
          />
          <FieldHint id="thresholdKub-hint" error={err("thresholdKub")}>
            {hints.hasPrincipal
              ? `R* ของระบบ = ${hints.rStarLabel} KUB — ตั้งต่ำกว่านี้ = จ่ายค่า gas บ่อยเกิน, สูงกว่านี้ = reward รอนานเกิน`
              : "ยังไม่มีเงินต้น — R* จะคำนวณได้หลัง delegate"}
          </FieldHint>
        </div>
      ) : null}

      {v.mode === "schedule" ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scheduleKind">รูปแบบเวลา</Label>
              <Select
                items={KIND_ITEMS}
                value={v.scheduleKind}
                onValueChange={(k) => {
                  if (k) set("scheduleKind")(String(k));
                }}
              >
                <SelectTrigger id="scheduleKind" className="w-full" aria-invalid={err("scheduleKind") ? true : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ITEMS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("scheduleKind") ? <p className="text-destructive text-xs">{err("scheduleKind")}</p> : null}
            </div>

            {v.scheduleKind === "every_hours" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="everyHours">ทุก N ชั่วโมง</Label>
                <Input
                  id="everyHours"
                  type="number"
                  min={1}
                  max={168}
                  inputMode="numeric"
                  value={v.everyHours}
                  onChange={(e) => set("everyHours")(e.target.value)}
                  aria-invalid={err("everyHours") ? true : undefined}
                  aria-describedby="everyHours-hint"
                />
                <FieldHint id="everyHours-hint" error={err("everyHours")}>
                  N = 1–23 หรือ 24, 48, …, 168 (เริ่มที่นาทีที่ 0)
                </FieldHint>
              </div>
            ) : null}

            {v.scheduleKind === "every_days" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="everyDays">ทุก N วัน</Label>
                <Input
                  id="everyDays"
                  type="number"
                  min={1}
                  max={31}
                  inputMode="numeric"
                  value={v.everyDays}
                  onChange={(e) => set("everyDays")(e.target.value)}
                  aria-invalid={err("everyDays") ? true : undefined}
                  aria-describedby="everyDays-hint"
                />
                <FieldHint id="everyDays-hint" error={err("everyDays")}>
                  นับตามวันที่ของเดือน (1, 1+N, …) — ช่วงสิ้นเดือนรอบอาจสั้นกว่า N วัน
                </FieldHint>
              </div>
            ) : null}

            {v.scheduleKind === "weekly" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dow">วัน</Label>
                <Select
                  items={DOW_ITEMS}
                  value={v.dow}
                  onValueChange={(d) => {
                    if (d) set("dow")(String(d));
                  }}
                >
                  <SelectTrigger id="dow" className="w-full" aria-invalid={err("dow") ? true : undefined}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW_ITEMS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err("dow") ? <p className="text-destructive text-xs">{err("dow")}</p> : null}
              </div>
            ) : null}

            {v.scheduleKind === "every_days" || v.scheduleKind === "daily" || v.scheduleKind === "weekly" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="time">เวลา (HH:mm, {timeZone})</Label>
                <Input
                  id="time"
                  type="time"
                  step={60}
                  value={v.time}
                  onChange={(e) => set("time")(e.target.value)}
                  aria-invalid={err("time") ? true : undefined}
                  aria-describedby="time-hint"
                />
                <FieldHint id="time-hint" error={err("time")}>
                  24 ชั่วโมง
                </FieldHint>
              </div>
            ) : null}

            {v.scheduleKind === "custom" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cron">Cron expression</Label>
                <Input
                  id="cron"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="นาที ชั่วโมง วัน เดือน วันในสัปดาห์ เช่น 0 9 * * 1-5"
                  className="font-mono"
                  value={v.cron}
                  onChange={(e) => set("cron")(e.target.value)}
                  aria-invalid={err("cron") ? true : undefined}
                  aria-describedby="cron-hint"
                />
                <FieldHint id="cron-hint" error={err("cron")}>
                  5 ฟิลด์ · รอบต้องห่างกันอย่างน้อย 1 ชั่วโมง
                </FieldHint>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-live="polite">
            {preview && preview.ok ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{preview.description}</span>
                  <code className="text-muted-foreground font-mono text-xs">{preview.expr}</code>
                </div>
                <div className="text-muted-foreground text-xs">3 รอบถัดไป ({timeZone}):</div>
                <ol className="list-decimal space-y-0.5 pl-5 tabular-nums" data-testid="next-runs">
                  {preview.runs.map((r, i) => (
                    <li key={i} suppressHydrationWarning>
                      {r}
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <span className="text-destructive">{preview?.ok === false ? preview.error : ""}</span>
            )}
          </div>

          <div className="flex max-w-sm flex-col gap-1.5">
            <Label htmlFor="minRewardKub">
              Reward ขั้นต่ำต่อรอบ <span className="text-muted-foreground font-normal">(KUB, ไม่บังคับ)</span>
            </Label>
            <Input
              id="minRewardKub"
              inputMode="decimal"
              autoComplete="off"
              placeholder={`ค่าเริ่มต้น ≈ ${hints.defaultMinRewardLabel}`}
              value={v.minRewardKub}
              onChange={(e) => set("minRewardKub")(e.target.value)}
              aria-invalid={err("minRewardKub") ? true : undefined}
              aria-describedby="minRewardKub-hint"
            />
            <FieldHint id="minRewardKub-hint" error={err("minRewardKub")}>
              ค่าเริ่มต้น = 2× ค่า gas ≈ {hints.defaultMinRewardLabel} KUB — ถึงเวลาแล้ว reward น้อยกว่านี้จะข้ามรอบ (dust_reward)
            </FieldHint>
          </div>
        </div>
      ) : null}

      {/* the result of the last save — hidden once the form is edited again */}
      <ActionMessage state={edited.size === 0 ? state : null} />
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
        </Button>
      </div>
    </form>
  );
}
