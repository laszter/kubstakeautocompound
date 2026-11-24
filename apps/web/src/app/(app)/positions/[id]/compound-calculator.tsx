"use client";

import { compoundProjection } from "@kubstake/core/browser";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// What-if calculator: net result of each threshold vs never compounding. Starts from this position's live
// numbers; edits stay in the browser and never touch the saved settings.

export type CalculatorInitial = {
  principalKub: number;
  aprPct: number;
  gasGwei: number;
  gasUnits: number;
};

type Props = {
  initial: CalculatorInitial;
  /** The position's active trigger (threshold or optimal target); null in schedule mode. */
  currentTargetKub: number | null;
};

type Fields = { principal: string; apr: string; gwei: string; units: string; years: string; custom: string };

const PRESETS_KUB = [0.1, 0.5, 1, 2, 5];
const HORIZONS_YEARS = [1, 3, 5, 10];
const DEFAULT_YEARS = "5";

const trimNum = (n: number, maxFrac: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: maxFrac, useGrouping: false }) : "";

function toFields(i: CalculatorInitial, years: string, custom: string): Fields {
  return {
    principal: trimNum(i.principalKub, 4),
    apr: trimNum(i.aprPct, 4),
    gwei: trimNum(i.gasGwei, 2),
    units: trimNum(i.gasUnits, 0),
    years,
    custom,
  };
}

const parse = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  return t === "" ? Number.NaN : Number(t);
};

const fmt = (n: number, frac: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac });

function fmtSigned(n: number, frac = 4): string {
  const r = Number(n.toFixed(frac));
  if (r === 0) return fmt(0, frac);
  return `${r > 0 ? "+" : "−"}${fmt(Math.abs(r), frac)}`;
}

function fmtThreshold(kub: number): string {
  return kub.toLocaleString("en-US", { maximumFractionDigits: kub < 1 ? 4 : 3 });
}

function fmtInterval(years: number): string {
  const days = years * 365;
  if (days < 1) return `${fmt(days * 24, 0)} ชม.`;
  return days >= 365 ? `${fmt(days, 0)} วัน (${fmt(years, 1)} ปี)` : `${fmt(days, 0)} วัน`;
}

function fmtPayback(years: number): string {
  return years < 1 ? `${fmt(years * 12, 1)} เดือน` : `${fmt(years, 1)} ปี`;
}

function NetCell({ value }: { value: number }) {
  const r = Number(value.toFixed(4));
  return (
    <TableCell className={cn("text-right tabular-nums", r > 0 ? "text-success" : r < 0 ? "text-destructive" : "text-muted-foreground")}>
      {fmtSigned(value)}
    </TableCell>
  );
}

type Row = { kub: number; tags: string[] };

/** R*, the active target, presets and the custom value, merged when equal, ascending. */
function buildRows(rStar: number, current: number | null, custom: number): Row[] {
  const rows: Row[] = [];
  const add = (kub: number, tag?: string) => {
    if (!(kub > 0) || !Number.isFinite(kub)) return;
    const same = rows.find((r) => Math.abs(r.kub - kub) <= 1e-9 * Math.max(1, kub));
    if (same) {
      if (tag && !same.tags.includes(tag)) same.tags.push(tag);
    } else rows.push({ kub, tags: tag ? [tag] : [] });
  };
  add(rStar, "R* (optimal)");
  if (current !== null) add(current, "ใช้อยู่ตอนนี้");
  if (Number.isFinite(custom)) add(custom, "ค่าที่ลอง");
  for (const k of PRESETS_KUB) add(k);
  return rows.sort((a, b) => a.kub - b.kub);
}

function Field({
  id,
  label,
  unit,
  value,
  onChange,
  invalid,
  placeholder,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>
        {label} <span className="text-muted-foreground font-normal">({unit})</span>
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
      />
    </div>
  );
}

export function CompoundCalculator({ initial, currentTargetKub }: Props) {
  const [f, setF] = useState<Fields>(() => toFields(initial, DEFAULT_YEARS, ""));
  const set = (k: keyof Fields) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const principalKub = parse(f.principal);
  const apr = parse(f.apr) / 100;
  const gwei = parse(f.gwei);
  const units = parse(f.units);
  const years = parse(f.years);
  const custom = parse(f.custom);
  const costKub = (gwei * units) / 1e9;

  const bad = {
    principal: !(principalKub > 0),
    apr: !(apr > 0),
    gwei: !(gwei >= 0),
    units: !(units >= 0),
    years: !(years >= 0),
    custom: f.custom.trim() !== "" && !(custom > 0),
  };
  const ready = !bad.principal && !bad.apr && !bad.gwei && !bad.units && !bad.years;

  const rewardPerYear = principalKub * apr;
  const rStar = Math.sqrt(2 * costKub * principalKub);
  const rows = ready ? buildRows(rStar, currentTargetKub, custom) : [];
  const project = (kub: number, T: number) =>
    compoundProjection({ principalKub, apr, costKub, thresholdKub: kub, years: T });

  const tagBadges = (tags: string[]) =>
    tags.map((t) => (
      <Badge key={t} variant={t === "R* (optimal)" ? "success" : t === "ใช้อยู่ตอนนี้" ? "info" : "outline"}>
        {t}
      </Badge>
    ));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="calc-principal" label="เงินต้น" unit="KUB" value={f.principal} onChange={set("principal")} invalid={bad.principal} />
        <Field id="calc-apr" label="APR สุทธิ" unit="% ต่อปี" value={f.apr} onChange={set("apr")} invalid={bad.apr} />
        <Field id="calc-years" label="ระยะเวลาที่จะถือ" unit="ปี" value={f.years} onChange={set("years")} invalid={bad.years} />
        <Field id="calc-gwei" label="Gas price" unit="gwei" value={f.gwei} onChange={set("gwei")} invalid={bad.gwei} />
        <Field id="calc-units" label="Gas ต่อการ compound" unit="units" value={f.units} onChange={set("units")} invalid={bad.units} />
        <Field
          id="calc-custom"
          label="ลอง threshold อื่น"
          unit="KUB"
          value={f.custom}
          onChange={set("custom")}
          invalid={bad.custom}
          placeholder="เช่น 0.04"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {ready ? (
            <>
              ค่า gas ต่อครั้ง <span className="text-foreground tabular-nums">{fmt(costKub, 6)} KUB</span> · reward ต่อปี{" "}
              <span className="text-foreground tabular-nums">{fmt(rewardPerYear, 4)} KUB</span> · R*{" "}
              <span className="text-foreground tabular-nums">{fmtThreshold(rStar)} KUB</span>
              {rewardPerYear > 0 ? <> (รอ {fmtInterval(rStar / rewardPerYear)})</> : null}
            </>
          ) : (
            "ใส่เงินต้นและ APR ที่มากกว่า 0 เพื่อคำนวณ"
          )}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setF(toFields(initial, f.years, f.custom))}>
          ใช้ค่าล่าสุดของ position
        </Button>
      </div>

      {ready ? (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">ถ้าถือ {trimNum(years, 2)} ปี</h3>
            <div className="mx-[calc(var(--card-spacing)*-1)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threshold</TableHead>
                    <TableHead className="text-right">compound ทุก</TableHead>
                    <TableHead className="text-right">คืนทุน gas ต่อครั้ง</TableHead>
                    <TableHead className="text-right">ได้จากทบต้น</TableHead>
                    <TableHead className="text-right">ค่า gas รวม</TableHead>
                    <TableHead className="text-right">สุทธิเทียบไม่ compound</TableHead>
                    <TableHead className="text-right">จำนวนครั้ง</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const r = project(row.kub, years);
                    if (!r) return null;
                    return (
                      <TableRow key={row.kub}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="tabular-nums whitespace-nowrap">{fmtThreshold(row.kub)} KUB</span>
                            {tagBadges(row.tags)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtInterval(r.intervalYears)}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtPayback(r.paybackYears)}</TableCell>
                        <TableCell className="text-right tabular-nums">+{fmt(r.gainKub, 4)}</TableCell>
                        <TableCell className="text-right tabular-nums">−{fmt(r.gasKub, 4)}</TableCell>
                        <NetCell value={r.netKub} />
                        <TableCell className="text-right tabular-nums">{r.compounds.toLocaleString("en-US")}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">สุทธิเทียบไม่ compound ตามระยะเวลาที่ถือ (KUB)</h3>
            <div className="mx-[calc(var(--card-spacing)*-1)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threshold</TableHead>
                    {HORIZONS_YEARS.map((T) => (
                      <TableHead key={T} className="text-right">
                        {T} ปี
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.kub}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular-nums whitespace-nowrap">{fmtThreshold(row.kub)} KUB</span>
                          {tagBadges(row.tags)}
                        </div>
                      </TableCell>
                      {HORIZONS_YEARS.map((T) => {
                        const r = project(row.kub, T);
                        return r ? <NetCell key={T} value={r.netKub} /> : <TableCell key={T} />;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      ) : null}

      <p className="text-muted-foreground text-xs">
        สุทธิ = ส่วนที่ได้จากทบต้น − ค่า gas เทียบกับปล่อย reward ค้างไว้โดยไม่ compound เลย · compound R KUB ได้ดอกเพิ่ม R × APR ต่อปี
        จึงคืนทุน gas ใน C ÷ (R × APR) ปี · R* ได้สุทธิมากที่สุดเมื่อถือยาว ถ้าถือไม่กี่ปี threshold ที่สูงกว่าอาจได้มากกว่าเล็กน้อย · สมมติว่า reward ที่ค้างไม่ได้ดอก, APR และ gas price คงที่, ไม่นับเงินต้นที่โตระหว่างทาง
        (คลาดเคลื่อนไม่ถึง 1%) · ตัวเลขที่แก้ในการ์ดนี้ไม่เปลี่ยนการตั้งค่าจริง
      </p>
    </div>
  );
}
