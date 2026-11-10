import { ArrowRight } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { CHAPTERS, EXAMPLE_NIGHT_LABEL, type Sky } from "./content";
import { useChapterProgress } from "./useChapterProgress";

/** "One night, scrolled": a sticky clock beside five chapters, one per part of the app. */
export function StoryChapters({ onSky }: { onSky: (sky: Sky) => void }) {
  const { active, seen, register } = useChapterProgress(CHAPTERS.map((c) => c.id));
  const current = CHAPTERS.find((c) => c.id === active) ?? CHAPTERS[0];

  // The page sky follows the night: each chapter reports its twilight band as it becomes active.
  useEffect(() => onSky(current.sky), [current.sky, onSky]);

  return (
    <div className="landing-story">
      <div className="landing-clock" aria-hidden>
        <div className="landing-clock-time">{current.time}</div>
        <div className="landing-clock-moment">{current.moment}</div>
        <div className="landing-clock-bar">
          <i style={{ "--landing-progress": current.progress / 100 } as CSSProperties} />
        </div>
        <p className="landing-clock-note">{EXAMPLE_NIGHT_LABEL}</p>
      </div>

      <ol className="m-0 list-none p-0">
        {CHAPTERS.map((c, i) => (
          <li
            key={c.id}
            ref={register(i)}
            data-chapter={c.id}
            data-seen={seen(i) ? "" : undefined}
            className="landing-chapter"
            aria-labelledby={`chapter-${c.id}`}
          >
            <p className="landing-eyebrow">
              <span className="sr-only">
                {c.moment}
                {/^\d/.test(c.time) ? `, ${c.time}` : ""}:{" "}
              </span>
              {c.eyebrow}
            </p>
            <h3 id={`chapter-${c.id}`} className="landing-h2 mt-2.5 mb-3.5 max-w-[18ch]">
              {c.title}
            </h3>
            <p className="landing-lede mb-6 max-w-[52ch]">{c.body}</p>
            {c.link && (
              <Link to={c.link.to} className="landing-press mb-7 inline-flex items-center gap-1.5 text-sm font-semibold text-ice hover:underline">
                {c.link.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
            <div className="landing-shot">
              <img src={c.shot.src} alt={c.shot.alt} loading="lazy" decoding="async" width={1440} height={900} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

