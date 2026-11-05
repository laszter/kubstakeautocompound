import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Reference empty state: 96px muted circle + 40px muted icon + text + optional CTA (pill). Server-safe (no hooks). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 px-4 py-10 text-center", className)}>
      <div className="flex size-24 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-10 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <div className="text-base font-semibold">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
