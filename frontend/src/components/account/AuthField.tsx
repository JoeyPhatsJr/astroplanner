import { CircleAlert } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";

interface Props {
  id: string;
  label: string;
  /** "text" is for a typed confirmation such as DELETE: no autofill, no spelling fixes, capitals on phones. */
  kind: "email" | "password" | "text";
  autoComplete: "email" | "current-password" | "new-password" | "off";
  /** The form field name; by default "email", "password" or "new-password" from the kind and autocomplete. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  help?: string;
  /** Beside the label, e.g. "Forgot password?". */
  aside?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}

/** One labelled field of the sign-in forms. Help and the inline error are tied to the input for screen readers. */
export function AuthField({ id, label, kind, autoComplete, name, value, onChange, error, help, aside, inputRef }: Props) {
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
          name={name ?? (password ? (autoComplete === "new-password" ? "new-password" : "password") : kind)}
          type={password ? (shown ? "text" : "password") : kind}
          inputMode={kind === "email" ? "email" : undefined}
          autoComplete={autoComplete}
          autoCapitalize={kind === "text" ? "characters" : "none"}
          autoCorrect="off"
          spellCheck={false}
          placeholder={kind === "email" ? "you@example.com" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`auth-input ${password ? "auth-input-toggle" : ""}`}
        />
        {password && (
          // The label says what a press will do, so it carries the state itself (no aria-pressed).
          <button type="button" className="auth-show" aria-controls={id} onClick={() => setShown((s) => !s)}>
            {shown ? "Hide" : "Show"} <span className="sr-only">password</span>
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
