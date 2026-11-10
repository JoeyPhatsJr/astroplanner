import { Link } from "react-router-dom";
import { useAstroLogHistory } from "../../api/astrolog";
import { formatIntegration } from "../../lib/time";

/** "You have 1 h 49 m stacked" for targets already in the AstroLog library; nothing otherwise. */
export function HistoryBadge({ catalogId, className = "" }: { catalogId: string; className?: string }) {
  const entry = useAstroLogHistory().data?.[catalogId];
  if (!entry || entry.seconds == null) return null;
  return (
    <Link
      to={`/astrolog/targets/${encodeURIComponent(entry.library_target_id)}`}
      className={`badge text-ice hover:border-ice/60 ${className}`}
    >
      You have {formatIntegration(entry.seconds)} {entry.label === "stack" ? "stacked" : "captured"}
    </Link>
  );
}
