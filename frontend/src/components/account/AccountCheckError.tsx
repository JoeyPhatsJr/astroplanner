import { useMe } from "../../api/auth";
import { ErrorState } from "../ui/States";

/** The account check (/api/auth/me) failed for a reason other than "signed out": say so, with a retry. */
export function AccountCheckError() {
  const me = useMe();
  return (
    <div className="acct-check-error">
      <ErrorState title="Couldn’t check your account" error={me.error} onRetry={() => void me.refetch()} />
    </div>
  );
}
