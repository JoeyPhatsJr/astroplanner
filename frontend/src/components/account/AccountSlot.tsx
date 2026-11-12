import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuthStatus, useMe, useSignOut } from "../../api/auth";
import { loginHref } from "../../lib/returnTo";

/** On these pages the page itself is the way in, so the slot stays empty. */
const AUTH_PAGES = new Set(["/login", "/signup", "/login/reset-help"]);

/**
 * The header's account slot, in the site header and the app shell top bar. Signed out: "Sign in", which
 * comes back to this page. Signed in: the account's initial, opening a disclosure of links (not an ARIA menu).
 */
export function AccountSlot({ variant }: { variant: "site" | "shell" }) {
  const loc = useLocation();
  const me = useMe();
  const signInRef = useRef<HTMLAnchorElement>(null);
  const focusSignIn = useRef(false);
  const status = useAuthStatus();

  // After "Sign out" the menu button is gone; put focus on its replacement instead of dropping it on the page.
  useEffect(() => {
    if (status === "signedOut" && focusSignIn.current) {
      focusSignIn.current = false;
      signInRef.current?.focus();
    }
  }, [status]);

  if (AUTH_PAGES.has(loc.pathname.toLowerCase().replace(/(.)\/+$/, "$1"))) return null;
  // Same footprint while the account loads, so the header does not shift when the answer arrives.
  if (status === "loading") return <span className="account-slot account-slot-pending" aria-hidden="true" data-variant={variant} />;
  if (status === "signedOut" || !me.data) {
    return (
      <Link ref={signInRef} to={loginHref(loc.pathname + loc.search)} className="account-slot account-signin" data-variant={variant}>
        Sign in
      </Link>
    );
  }
  return <AccountMenu email={me.data.email} variant={variant} onSignedOut={() => (focusSignIn.current = true)} />;
}

function AccountMenu({ email, variant, onSignedOut }: { email: string; variant: "site" | "shell"; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [byKeyboard, setByKeyboard] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const signOut = useSignOut({ onSignedOut });
  const initial = ([...email][0] ?? "?").toUpperCase();

  // A press anywhere outside closes it (pointerdown, so the press that lands elsewhere also does its own job).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  };
  // Tabbing past the last link closes it. A press on the menu's own text moves focus nowhere (relatedTarget null).
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !wrap.current?.contains(to)) setOpen(false);
  };
  const close = () => setOpen(false);

  return (
    <div ref={wrap} className="account-slot account-menu-wrap" data-variant={variant} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="account-avatar"
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(e) => {
          setByKeyboard(e.detail === 0); // Enter or Space: a click with no pointer
          setOpen((o) => !o);
        }}
      >
        {initial}
      </button>
      {open && (
        <nav id={menuId} aria-label="Account" className="account-menu" data-instant={byKeyboard || undefined}>
          <p className="account-menu-email">{email}</p>
          <ul>
            <li>
              <Link to="/astrolog" onClick={close}>
                AstroLog
              </Link>
            </li>
            <li>
              <Link to="/account" onClick={close}>
                Account
              </Link>
            </li>
          </ul>
          <hr />
          <button
            type="button"
            aria-disabled={signOut.isPending || undefined}
            onClick={() => {
              if (!signOut.isPending) signOut.mutate();
            }}
          >
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
          {signOut.isError && (
            <p role="alert" className="account-menu-err">
              Couldn’t sign out. {signOut.error.message}
            </p>
          )}
        </nav>
      )}
    </div>
  );
}
