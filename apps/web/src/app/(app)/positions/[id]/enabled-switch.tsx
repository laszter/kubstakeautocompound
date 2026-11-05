"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { togglePosition } from "./actions";

/** Auto-compound on/off — saved immediately via togglePosition(id, enabled). */
export function EnabledSwitch({ positionId, enabled }: { positionId: string; enabled: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function onChange(next: boolean) {
    startTransition(async () => {
      setOptimistic(next);
      const r = await togglePosition(positionId, next);
      startTransition(() => setResult(r));
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Switch checked={optimistic} onCheckedChange={onChange} disabled={isPending} aria-label="เปิด/ปิด auto-compound" />
        {optimistic ? "auto-compound เปิด" : "auto-compound ปิด"}
      </label>
      {result ? (
        <span className={cn("text-xs", result.ok ? "text-muted-foreground" : "text-destructive")} aria-live="polite">
          {result.ok ? result.message : result.error}
        </span>
      ) : null}
    </div>
  );
}
