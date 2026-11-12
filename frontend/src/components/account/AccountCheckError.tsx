import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useAuthStatus, useMe } from "../../api/auth";
import { ErrorState } from "../ui/States";

export const ACCOUNT_CHECK_REASON = "Couldn’t check your account.";

type Focusable = HTMLElement & { disabled?: boolean };

/**
 * The account check's one retry, shared by the error panel and the note beside an Add control.
 *
 * - `failed`: the check failed, or a retry from here has not answered yet. A retry in flight reads as "loading"
 *   (see `useAuthStatus`), so without this the retry button would vanish under the user's finger and focus
 *   would drop to the page. While `retrying` it stays, labelled, and a second press asks nothing.
 * - When the answer arrives and the note goes away, focus moves from the retry button (if it had focus) to the
 *   first of `focusAfter` that can take it: the Add control or the sign-in link, then a fallback.
 */
export function useAccountCheckRetry(focusAfter: RefObject<Focusable | null>[] = []) {
  const me = useMe();
  const status = useAuthStatus();
  const [phase, setPhase] = useState<"idle" | "asking" | "answered">("idle");
  const busy = useRef(false);
  const handOff = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function retry() {
    if (busy.current) return;
    busy.current = true;
    setPhase("asking");
    await me.refetch();
    setPhase("answered");
  }

  useEffect(() => {
    if (phase !== "answered" || status === "loading") return;
    // Measured while the button is still on screen: it goes away on the next render unless the check failed again.
    handOff.current = status !== "error" && buttonRef.current !== null && buttonRef.current === document.activeElement;
    busy.current = false;
    setPhase("idle");
  }, [phase, status]);

  useEffect(() => {
    if (phase !== "idle" || !handOff.current) return;
    handOff.current = false;
    const target = focusAfter.map((r) => r.current).find((el) => el?.isConnected && !el.disabled);
    target?.focus();
    // focusAfter is a list of refs read at hand-off time; only the phase change matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return { failed: status === "error" || phase !== "idle", retrying: phase !== "idle", retry, buttonRef, error: me.error };
}

export type AccountCheckRetry = ReturnType<typeof useAccountCheckRetry>;

/** The account check (/api/auth/me) failed for a reason other than "signed out": say so, with a retry. */
export function AccountCheckError() {
  const check = useAccountCheckRetry();
  return (
    <div className="acct-check-error">
      <ErrorState title="Couldn’t check your account" error={check.error} onRetry={() => void check.retry()} />
    </div>
  );
}

/**
 * The same failure as a short note beside a disabled Add control: the reason (link it to the control with
 * aria-describedby={id}) and a retry, which stays put while the check is asked again.
 */
export function AccountCheckNote({ id, check, className = "" }: { id: string; check: AccountCheckRetry; className?: string }) {
  return (
    <div className={`acct-check-note ${className}`}>
      <p id={id} className="text-xs text-ink-2">
        {ACCOUNT_CHECK_REASON}
      </p>
      <button
        ref={check.buttonRef}
        type="button"
        className="btn acct-check-retry"
        aria-disabled={check.retrying || undefined}
        aria-describedby={id}
        onClick={() => void check.retry()}
      >
        <RotateCw className="size-4" aria-hidden />
        Try again
      </button>
    </div>
  );
}
