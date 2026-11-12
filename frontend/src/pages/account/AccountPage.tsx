import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuthStatus, useMe, useSignOut } from "../../api/auth";
import { useDocTitle } from "../../components/account/AuthSplit";
import { ChangePasswordForm } from "../../components/account/ChangePasswordForm";
import { DeleteAccountDialog } from "../../components/account/DeleteAccountDialog";
import { PageHeader } from "../../components/ui/PageHeader";
import { PageLoading } from "../../components/ui/PageLoading";
import { Notice } from "../../components/ui/States";
import { loginHref } from "../../lib/returnTo";
import { formatDayMonthYear } from "../../lib/time";

/**
 * The Account page (/account): who is signed in, change password, sign out and delete account.
 * Signed out, it goes to sign in and comes back here.
 */
export function AccountPage() {
  useDocTitle("Account");
  const status = useAuthStatus();
  const me = useMe();
  const navigate = useNavigate();
  // Sign out and delete go home. The page navigates first, then the app switches to signed out; until the
  // route changes, this guard keeps the signed-out redirect to sign in from racing the trip home.
  const leaving = useRef(false);
  const goHome = () => {
    leaving.current = true;
    navigate("/", { replace: true });
  };
  const signOut = useSignOut({ onSignedOut: goHome });
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [dialog, setDialog] = useState<"open" | "closing" | null>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  // When the form closes, its trigger comes back: put focus there, not on the page.
  const refocus = useRef(false);
  useEffect(() => {
    if (!changing && refocus.current) {
      refocus.current = false;
      changeButton.current?.focus();
    }
  }, [changing]);

  if (leaving.current) return null;
  if (status === "loading") return <PageLoading />;
  if (status === "signedOut" || !me.data) return <Navigate to={loginHref("/account")} replace />;
  const account = me.data;
  const created = formatDayMonthYear(account.created_at);

  const closeForm = (done: boolean) => {
    refocus.current = true;
    setChanging(false);
    setChanged(done);
  };

  return (
    <div className="page-reading">
      <div className="acct">
        <PageHeader title="Account" />

        <section className="acct-box" aria-labelledby="acct-signed-in">
          <h2 id="acct-signed-in" className="acct-h2">
            Signed in
          </h2>
          <dl className="acct-kv">
            <div>
              <dt>Email</dt>
              <dd className="acct-email" translate="no">
                {account.email}
              </dd>
            </div>
            {created && (
              <div>
                <dt>Account created</dt>
                <dd>{created}</dd>
              </div>
            )}
          </dl>
          {account.claimed_existing && (
            <div className="mt-3">
              <Notice>Your existing plans and AstroLog library were added to this account.</Notice>
            </div>
          )}
        </section>

        <section className="acct-box" aria-labelledby="acct-password">
          <h2 id="acct-password" className="acct-h2">
            Password
          </h2>
          <p className="acct-p">Change it here; you’ll stay signed in on this device.</p>
          {changing ? (
            <ChangePasswordForm email={account.email} onChanged={() => closeForm(true)} onCancel={() => closeForm(false)} />
          ) : (
            <button
              ref={changeButton}
              type="button"
              className="btn acct-btn acct-btn-ghost"
              onClick={() => {
                setChanged(false);
                setChanging(true);
              }}
            >
              Change password
            </button>
          )}
          <div role="status" className="acct-status">
            {changed && <Notice>Password changed. Other devices were signed out.</Notice>}
          </div>
        </section>

        <section className="acct-box" aria-labelledby="acct-data">
          <h2 id="acct-data" className="acct-h2">
            Your data
          </h2>
          <p className="acct-p">
            Your session plans, AstroLog library, final-picture previews and processing notes are stored with this account.{" "}
            <Link to="/privacy" className="acct-link">
              Privacy
            </Link>{" "}
            lists everything.
          </p>
          <button
            type="button"
            className="btn acct-btn acct-btn-ghost"
            aria-disabled={signOut.isPending || undefined}
            onClick={() => {
              if (!signOut.isPending) signOut.mutate();
            }}
          >
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
          {signOut.isError && (
            <p role="alert" className="auth-err acct-err">
              Couldn’t sign out. {signOut.error.message}
            </p>
          )}
        </section>

        <section className="acct-box acct-box-danger" aria-labelledby="acct-delete">
          <h2 id="acct-delete" className="acct-h2">
            Delete account
          </h2>
          <p className="acct-p">Removes your account and everything stored with it. This can’t be undone.</p>
          <button ref={deleteButton} type="button" className="btn acct-btn acct-btn-danger" onClick={() => setDialog("open")}>
            Delete account…
          </button>
        </section>
      </div>

      {dialog && (
        <DeleteAccountDialog
          open={dialog === "open"}
          onDismiss={() => setDialog("closing")}
          onClosed={() => {
            setDialog(null);
            deleteButton.current?.focus();
          }}
          onDeleted={goHome}
        />
      )}
    </div>
  );
}
