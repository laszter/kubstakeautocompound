import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page title block: optional back link (muted) → h1 → description → actions (right-aligned, wrap below on narrow
 * screens). `description` renders in a <div>, so it may contain chips/blocks. Server-safe.
 */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "กลับ",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
