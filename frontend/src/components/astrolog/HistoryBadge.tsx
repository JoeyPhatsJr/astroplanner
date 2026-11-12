import { Link } from "react-router-dom";
import { useAstroLogHistory } from "../../api/astrolog";
import { useAuthStatus } from "../../api/auth";
import { formatIntegration } from "../../lib/time";

/**
 * "You have 1 h 49 m stacked" for targets already in the signed-in user's AstroLog library; nothing otherwise.
 * Progress is personal: signed out there is no badge, even if a session that just ended left one in the cache.
 */
export function HistoryBadge({ catalogId, className = "" }: { catalogId: string; className?: string }) {
  const signedIn = useAuthStatus() === "signedIn";
  const entry = useAstroLogHistory().data?.[catalogId];
  if (!signedIn || !entry || entry.seconds == null) return null;
  return (
    <Link
      to={`/astrolog/targets/${encodeURIComponent(entry.library_target_id)}`}
      className={`badge badge-accent hover:bg-ice/20 ${className}`}
    >
      You have {formatIntegration(entry.seconds)} {entry.label === "stack" ? "stacked" : "captured"}
    </Link>
  );
}
