import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  error?: string;
  autoFocus?: boolean;
};

/**
 * Uncontrolled password input with its label and hint/error line. The value only leaves the browser inside the form's
 * FormData and is cleared when React resets the form. No `maxLength`: truncating silently would store another password.
 */
export function PasswordField({ name, label, autoComplete, hint, error, autoFocus }: Props) {
  const message = error ?? hint;
  const messageId = `${name}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="password"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
      />
      {message ? (
        <p id={messageId} className={error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
