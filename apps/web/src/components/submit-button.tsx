"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type Props = Omit<React.ComponentProps<typeof Button>, "type"> & { pendingText?: string };

/** Submit button for a `<form action={...}>`: disabled + `pendingText` while the action runs. */
export function SubmitButton({ children, pendingText, disabled, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
