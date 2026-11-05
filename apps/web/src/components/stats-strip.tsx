import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatsStripItem = { label: ReactNode; value: ReactNode; hint?: ReactNode; title?: string };

type Columns = 2 | 3 | 4;

const LG_COLS: Record<Columns, string> = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
const LG_SPAN: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };

/**
 * Reference "overview" strip: ONE hairline card, equal cells split by 1px lines (gap-px over bg-border), big
 * centred numbers with a muted label below. 1 column on mobile, 2 at sm, `columns` (default = item count, 2–4) at lg.
 * The last cell stretches over any empty grid slots so no grey hole shows. Server-safe.
 */
export function StatsStrip({
  items,
  columns,
  className,
}: {
  items: StatsStripItem[];
  columns?: Columns;
  className?: string;
}) {
  const n: Columns = columns ?? (Math.min(Math.max(items.length, 2), 4) as Columns);
  const smRemainder = items.length % 2;
  const lgRemainder = items.length % n;

  return (
    <Card className={cn("gap-0 overflow-hidden p-0", className)}>
      <div className={cn("grid gap-px bg-border sm:grid-cols-2", LG_COLS[n])}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <div
              key={i}
              title={item.title}
              className={cn(
                "flex flex-col items-center justify-center bg-card px-4 py-5 text-center",
                last && smRemainder !== 0 && "sm:col-span-2",
                last && (smRemainder !== 0 || lgRemainder !== 0) && LG_SPAN[lgRemainder === 0 ? 1 : n - lgRemainder + 1],
              )}
            >
              <div className="text-2xl font-semibold tabular-nums">{item.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{item.label}</div>
              {item.hint ? <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
