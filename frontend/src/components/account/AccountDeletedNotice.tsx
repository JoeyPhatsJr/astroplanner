import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Router state the Account page sends home with after deleting the account. */
export const ACCOUNT_DELETED_STATE = { notice: "account-deleted" } as const;

/**
 * "Your account and its data were deleted.", shown once on arrival after Delete account, until dismissed.
 * The live region is on the page before its text, so screen readers announce the text when it appears.
 */
export function AccountDeletedNotice() {
  const loc = useLocation();
  const navigate = useNavigate();
  const arrived = (loc.state as { notice?: string } | null)?.notice === ACCOUNT_DELETED_STATE.notice;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!arrived) return;
    setShow(true);
    // Read once: clear it from this history entry, so a reload or Back does not show it again.
    navigate({ pathname: loc.pathname, search: loc.search, hash: loc.hash }, { replace: true, state: null });
  }, [arrived, navigate, loc.pathname, loc.search, loc.hash]);

  return (
    <div role="status" className="mx-auto max-w-[1160px] px-4 sm:px-10">
      {show && (
        <div className="landing-rise mt-6 flex items-center gap-3 rounded-lg border border-ice/25 bg-ice/5 py-1 pr-1 pl-3.5 text-sm text-ink-2">
          <Check className="size-4 shrink-0 text-ok" aria-hidden />
          <p className="m-0 flex-1">Your account and its data were deleted.</p>
          <button type="button" className="btn btn-ghost btn-icon size-11 shrink-0" aria-label="Dismiss" onClick={() => setShow(false)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
