import { useState } from "react";
import type { Target } from "../../api/types";
import { FramingDiagram, framingNote } from "./FramingDiagram";

/**
 * Picture slot of a card or drawer: a lazily loaded Digitized Sky Survey cutout over the framing diagram.
 * The diagram is the fallback, shown until the image loads and kept when it fails (the backend answers 503
 * when the survey is unreachable). A cold fetch can take up to a minute, hence lazy loading and the diagram meanwhile.
 * With fallback=false the diagram is not drawn here (the drawer shows it beside the image).
 */
export function SkyThumb({
  target,
  fovDeg,
  size,
  fallback = true,
}: {
  target: Target;
  fovDeg: number | null;
  size: number;
  fallback?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = target.sky_field_arcmin ?? null;
  const hasImage = field != null && !failed;
  const note = framingNote(target.angular_major_arcmin, fovDeg);
  const showDiagram = fallback && note != null;
  if (!hasImage && !showDiagram) return null;
  const width = field != null ? Number((field / 60).toFixed(2)) : null;
  return (
    <div className="relative flex-none self-start overflow-hidden rounded-[10px] bg-night-deep" style={{ width: size, height: size }}>
      {showDiagram && (
        <FramingDiagram major={target.angular_major_arcmin} minor={target.angular_minor_arcmin} fovDeg={fovDeg} size={size} />
      )}
      {hasImage && (
        <img
          src={`/api/targets/${encodeURIComponent(target.id)}/sky-image`}
          alt={`Digitized Sky Survey image of ${target.name}`}
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          data-loaded={loaded ? "" : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="vision-img absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-[var(--dur-small)] ease-[var(--ease-out)] data-[loaded]:opacity-100"
        />
      )}
      {hasImage && loaded && width != null && (
        <span className="absolute left-1 top-1 rounded-[5px] bg-black/60 px-1.5 text-micro font-semibold text-ink">{width}°</span>
      )}
      {note && (
        <span
          className={`absolute bottom-1 left-1 rounded-[5px] bg-black/60 px-1.5 text-micro font-semibold ${note.warn ? "text-warn" : "text-ink"}`}
        >
          {note.text}
        </span>
      )}
    </div>
  );
}
