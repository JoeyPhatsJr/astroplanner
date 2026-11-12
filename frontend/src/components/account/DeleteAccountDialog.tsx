import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDeleteAccount } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Overlay } from "../ui/Overlay";
import { AuthField } from "./AuthField";

const CONFIRM = "DELETE";

interface Props {
  open: boolean;
  /** Cancel, Escape or a press on the scrim: the parent sets `open` to false. */
  onDismiss: () => void;
  /** The exit animation has finished: the parent unmounts the dialog and puts focus back on its trigger. */
  onClosed: () => void;
  /** Runs once the account is gone, before the app switches to signed out, so the page can navigate first. */
  onDeleted: () => void;
}

/**
 * Delete account: an alert dialog that asks for the password and a typed DELETE. Delete stays disabled until
 * both are there (as in the approved mockup); the server checks both again.
 */
export function DeleteAccountDialog({ open, onDismiss, onClosed, onDeleted }: Props) {
  const del = useDeleteAccount({ onDeleted });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const ready = confirm === CONFIRM && password.length > 0;

  // The first thing to do here is type the password.
  useEffect(() => {
    if (open) passwordRef.current?.focus();
  }, [open]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || del.isPending) return;
    setErrors({});
    del.mutate(
      { password, confirm: CONFIRM },
      {
        onError: (err) => {
          if (!(err instanceof ApiError)) return;
          if (err.status === 400 || err.status === 429) {
            setErrors({ password: err.message });
            passwordRef.current?.focus();
            passwordRef.current?.select();
          } else if (err.status === 422) {
            setErrors({ confirm: err.message });
            confirmRef.current?.focus();
          }
        },
      },
    );
  };

  const err = del.error;
  const onField = err instanceof ApiError && [400, 401, 422, 429].includes(err.status);
  const alert = err && !onField ? `Couldn’t delete the account. ${err.message}` : null;

  return (
    <Overlay
      open={open}
      variant="modal"
      role="alertdialog"
      labelledBy="delete-account-title"
      describedBy="delete-account-desc"
      onDismiss={onDismiss}
      onClosed={onClosed}
      panelClassName="acct-dialog"
    >
      <form method="post" noValidate onSubmit={onSubmit} className="auth-form">
        <div>
          <h2 id="delete-account-title" className="acct-dialog-title">
            Delete your account?
          </h2>
          <p id="delete-account-desc" className="acct-dialog-desc">
            This permanently removes your session plans, AstroLog library, final-picture previews and processing notes. Your original files
            on your computer are not touched.
          </p>
        </div>
        {alert && (
          <p role="alert" className="auth-alert">
            {alert}
          </p>
        )}
        <AuthField
          id="delete-account-password"
          label="Password"
          kind="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          inputRef={passwordRef}
        />
        <AuthField
          id="delete-account-confirm"
          label="Type DELETE to confirm"
          kind="text"
          autoComplete="off"
          name="confirm-delete"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          inputRef={confirmRef}
        />
        <div className="acct-actions acct-dialog-actions">
          <button type="button" className="btn acct-btn acct-btn-ghost" onClick={onDismiss}>
            Cancel
          </button>
          <button type="submit" className="btn acct-btn acct-btn-danger" disabled={!ready} aria-disabled={del.isPending || undefined}>
            {del.isPending ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
