import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionResult } from "@/lib/action-result";

/** Shows the result of a server action (from `useActionState`); renders nothing for null / ok without message. */
export function ActionMessage({ state, className }: { state: ActionResult | null; className?: string }) {
  if (!state) return null;
  if (state.ok) {
    if (!state.message) return null;
    return (
      <Alert variant="success" className={className} aria-live="polite">
        <CircleCheckIcon />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" className={className} aria-live="polite">
      <CircleAlertIcon />
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}
