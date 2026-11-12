import type { Mission } from "../../api/variables";

/** A mission and, signed in, the user's own progress on it. Signed out (`progress` null) the card shows no count. */
export function MissionCard({ mission }: { mission: Mission }) {
  const { goal, progress } = mission;
  const pct = progress !== null && goal ? Math.min(100, Math.round((progress / goal) * 100)) : null;
  return (
    <article className="panel flex flex-col gap-2 p-4" aria-label={`Mission: ${mission.title}`}>
      <h3 className="font-semibold text-ink">{mission.title}</h3>
      <p className="text-sm text-ink-2">{mission.description}</p>
      {pct !== null && (
        <div
          className="h-2 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label={`${mission.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full bg-ice" style={{ width: `${pct}%` }} />
        </div>
      )}
      {progress !== null && (
        <p className="text-sm tabular-nums text-ink-2">
          {goal ? `${progress} of ${goal} ${mission.unit}` : `${progress} ${mission.unit}`}
        </p>
      )}
    </article>
  );
}
