import { useEffect, useRef, useState, type FormEvent } from "react";
import { passwordLengthError, useChangePassword } from "../../api/auth";
import { ApiError } from "../../api/client";
import { AuthField } from "./AuthField";

type FieldErrors = { current?: string; next?: string };

interface Props {
  /** The account's email, for password managers (they store the new password against it). */
  email: string;
  onChanged: () => void;
  onCancel: () => void;
}

/** Change password, inline on the Account page. Other devices are signed out; this one stays signed in. */
export function ChangePasswordForm({ email, onChanged, onCancel }: Props) {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);

  // The button that opened the form is gone: start where the typing starts.
  useEffect(() => {
    currentRef.current?.focus();
  }, []);

  const show = (errs: FieldErrors) => {
    setErrors(errs);
    if (errs.current) {
      // Ready to retype: focus, then select what is there.
      currentRef.current?.focus();
      currentRef.current?.select();
    } else if (errs.next) nextRef.current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (change.isPending) return;
    // Checked here before any request; the server applies the same rules.
    const errs: FieldErrors = {
      current: current ? undefined : "Enter your current password.",
      next: next ? (passwordLengthError(next) ?? undefined) : "Enter a new password.",
    };
    show(errs);
    if (errs.current || errs.next) {
      change.reset();
      return;
    }
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: onChanged,
        onError: (err) => {
          if (!(err instanceof ApiError)) return;
          // 400 wrong password, 429 too many wrong tries: both are about the current password.
          if (err.status === 400 || err.status === 429) show({ current: err.message });
          else if (err.status === 422) show({ next: err.message });
        },
      },
    );
  };

  const err = change.error;
  const onField = err instanceof ApiError && [400, 401, 422, 429].includes(err.status);
  const alert = err && !onField ? `Couldn’t change the password. ${err.message}` : null;

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="auth-form acct-form" aria-label="Change password">
      {/* Lets a password manager file the new password under this account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {alert && (
        <p role="alert" className="auth-alert">
          {alert}
        </p>
      )}
      <AuthField
        id="acct-current-password"
        label="Current password"
        kind="password"
        autoComplete="current-password"
        value={current}
        onChange={setCurrent}
        error={errors.current}
        inputRef={currentRef}
      />
      <AuthField
        id="acct-new-password"
        label="New password"
        kind="password"
        autoComplete="new-password"
        value={next}
        onChange={setNext}
        help="At least 12 characters."
        error={errors.next}
        inputRef={nextRef}
      />
      <div className="acct-actions">
        <button type="submit" className="btn acct-btn acct-btn-primary" aria-disabled={change.isPending || undefined}>
          {change.isPending ? "Saving…" : "Save password"}
        </button>
        <button type="button" className="btn acct-btn acct-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
