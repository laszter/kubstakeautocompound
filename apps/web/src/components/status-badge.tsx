import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * One colour per meaning (TASK §4 "Status"):
 * success = fresh worker / done / confirmed / auto / open for delegation · warning = backoff / not worth it /
 * paused / hot wallet · info = running / broadcast / hints · danger = failed / reverted / stale / claim-only / inactive ·
 * neutral = pending / signed / disabled / closed for delegation · outline = skipped / official pool / minimal set.
 */
export type StatusKind = "success" | "warning" | "info" | "danger" | "neutral" | "outline";

const VARIANT = {
  success: "success",
  warning: "warning",
  info: "info",
  danger: "destructive",
  neutral: "secondary",
  outline: "outline",
} as const satisfies Record<StatusKind, ComponentProps<typeof Badge>["variant"]>;

/** Server-safe status chip (no hooks) → `Badge` soft variant. `dot` adds a leading `currentColor` dot. */
export function StatusBadge({
  kind,
  dot = false,
  title,
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children" | "className" | "title"> & {
  kind: StatusKind;
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant={VARIANT[kind]} title={title} className={className} {...props}>
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </Badge>
  );
}
