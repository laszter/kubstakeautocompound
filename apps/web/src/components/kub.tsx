import { cn } from "@/lib/utils";

/**
 * Displays a KUB amount. `value` must already be formatted on the server with `formatKub(wei)`
 * (bigint can't be passed as an RSC prop). null/undefined → `placeholder`.
 */
export function Kub({
  value,
  unit = "KUB",
  placeholder = "-",
  className,
}: {
  value: string | null | undefined;
  unit?: string;
  placeholder?: string;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return <span className={cn("text-muted-foreground", className)}>{placeholder}</span>;
  }
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {value} <span className="text-muted-foreground text-[0.85em]">{unit}</span>
    </span>
  );
}
