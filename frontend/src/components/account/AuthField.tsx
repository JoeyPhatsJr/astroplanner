import { CircleAlert } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";

interface Props {
  id: string;
  label: string;
  kind: "email" | "password";
  autoComplete: "email" | "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  help?: string;
  /** Beside the label, e.g. "Forgot password?". */
  aside?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}

/** One labelled field of the sign-in forms. Help and the inline error are tied to the input for screen readers. */
export function AuthField({ id, label, kind, autoComplete, value, onChange, error, help, aside, inputRef }: Props) {
  const [shown, setShown] = useState(false);
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;
  const password = kind === "password";
  return (
    <div className="auth-field">
      <div className="auth-field-row">
        <label htmlFor={id} className="auth-label">
          {label}
        </label>
        {aside}
      </div>
      <div className="auth-input-wrap">
        <input
          ref={inputRef}
          id={id}
          name={password ? (autoComplete === "new-password" ? "new-password" : "password") : "email"}
          type={password ? (shown ? "text" : "password") : "email"}
          inputMode={password ? undefined : "email"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={password ? undefined : "you@example.com"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`auth-input ${password ? "auth-input-toggle" : ""}`}
        />
        {password && (
          // One name and a pressed state, so a screen reader hears "Show password, toggle button, pressed".
          <button type="button" className="auth-show" aria-pressed={shown} aria-controls={id} onClick={() => setShown((s) => !s)}>
            Show<span className="sr-only"> password</span>
          </button>
        )}
      </div>
      {help && (
        <p id={helpId} className="auth-help">
          {help}
        </p>
      )}
      {error && (
        <p id={errId} className="auth-err">
          <CircleAlert className="auth-err-icon" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
