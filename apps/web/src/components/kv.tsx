import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Key/value list with hairline dividers (validator tile, mobile cards, wallet card). Server-safe. */
export function KvList({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn("divide-y divide-border", className)}>{children}</dl>;
}

/** One row: muted label left, value right (tabular numbers). */
export function KvRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2", className)}>
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular-nums">{children}</dd>
    </div>
  );
}
