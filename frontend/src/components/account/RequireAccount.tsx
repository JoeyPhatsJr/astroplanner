import { Outlet } from "react-router-dom";
import { useAuthStatus } from "../../api/auth";
import { PageLoading } from "../ui/PageLoading";
import { AstroLogSignedOut } from "./AstroLogSignedOut";

/**
 * AstroLog and the Processing Coach need an account. While the account loads: the page skeleton. Signed out:
 * the signed-out screen in place of the page. A 401 from any of their requests flips the account to signed out
 * (see `createQueryClient`), so a session that ends mid-use lands here too, never on a raw error.
 */
export function RequireAccount() {
  const status = useAuthStatus();
  if (status === "loading") return <PageLoading />;
  if (status === "signedOut") return <AstroLogSignedOut />;
  return <Outlet />;
}
