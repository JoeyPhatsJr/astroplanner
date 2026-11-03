import { Link } from "react-router-dom";
import { useObserver } from "../../api/hooks";
import { useStarVisibility } from "../../api/variables";
import { formatTime, tzAbbrev } from "../../lib/time";
import { Skeleton } from "../ui/States";

/** One line: tonight's window above the minimum altitude, or why there is none. Calculated from the saved location. */
/** `bare` drops the "Tonight:" prefix for use under a heading that already says it. */
/** `plain` renders the no-location hint without a link, for use inside another link (no nested anchors). */
export function TonightWindow({ slug, plain = false, bare = false }: { slug: string; plain?: boolean; bare?: boolean }) {
  const o = useObserver();
  const q = useStarVisibility(slug);
  if (!o)
    return (
      <span className="text-sm text-muted">
        {plain ? (
          "Set a location in Settings to see tonight's window"
        ) : (
          <>
            Set a location in <Link to="/settings" className="text-ice hover:underline">Settings</Link> to see tonight&apos;s window
          </>
        )}
      </span>
    );
  if (q.isLoading) return <Skeleton className="h-5 w-48" label="Loading tonight's window" />;
  if (q.error || !q.data) return <span className="text-sm text-warn">Tonight&apos;s window unavailable</span>;
  const v = q.data.visibility;
  const tz = q.data.night.timezone;
  if (v.best_window)
    return (
      <span className="text-sm text-ink">
        {bare ? "Above" : "Tonight: above"} {v.min_altitude_deg}° from {formatTime(v.best_window.start_utc, tz)} to {formatTime(v.best_window.end_utc, tz)}{" "}
        {tzAbbrev(v.best_window.start_utc, tz)}
      </span>
    );
  return <span className="text-sm text-ink-2">{v.status_text}</span>;
}
