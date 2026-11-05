"use client";

import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { requestValidatorSync } from "./actions";

/** "รีเฟรชรายชื่อ" → enqueues sync_validators. `syncing` (from the page) = a sync action is pending/running. */
export function RefreshButton({ syncing }: { syncing: boolean }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(requestValidatorSync, null);
  // Success text is only relevant until the worker picks the sync up and finishes it; errors always show.
  const message = state && (!state.ok ? state.error : syncing ? state.message : undefined);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1.5 sm:items-end">
      <SubmitButton variant="outline" size="sm" disabled={syncing} pendingText="กำลังส่งคำสั่ง...">
        {syncing ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
        {syncing ? "กำลังซิงก์..." : "รีเฟรชรายชื่อ"}
      </SubmitButton>
      {message ? (
        <p
          className={cn("max-w-xs text-xs sm:text-right", state?.ok ? "text-muted-foreground" : "text-destructive")}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
