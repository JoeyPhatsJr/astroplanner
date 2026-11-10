import { useEffect, useRef, useState } from "react";
import type { Target } from "../../api/types";
import { loadSkyImageUrl } from "../../lib/skyImageQueue";
import { FramingDiagram, framingNote } from "./FramingDiagram";

/**
 * Picture slot of a card or drawer: a Digitized Sky Survey cutout over the framing diagram.
 * The diagram is the fallback, shown until the image loads and kept when it fails (the backend answers 503
 * when the survey is unreachable). A cold fetch can take many seconds, so images load only once the slot is
 * near the viewport, through a shared queue that runs at most two at a time (see lib/skyImageQueue).
 * A target without sky_field_arcmin (images switched off on the server) requests nothing.
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
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const field = target.sky_field_arcmin ?? null;
  const url = field != null ? `/api/targets/${encodeURIComponent(target.id)}/sky-image` : null;
  const hasImage = url != null && !failed;
  const note = framingNote(target.angular_major_arcmin, fovDeg);
  const showDiagram = fallback && note != null;

  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    const start = () =>
      void loadSkyImageUrl(url, ctl.signal).then((u) => {
        if (ctl.signal.aborted) return;
        if (u) setSrc(u);
        else setFailed(true);
      });
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "function" && box.current) {
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          start();
        },
        { rootMargin: "400px" },
      );
      io.observe(box.current);
    } else start();
    return () => {
      io?.disconnect();
      ctl.abort();
    };
  }, [url]);

  if (!hasImage && !showDiagram) return null;
  const width = field != null ? Number((field / 60).toFixed(2)) : null;
  return (
    <div ref={box} className="relative flex-none self-start overflow-hidden rounded-[10px] bg-night-deep" style={{ width: size, height: size }}>
      {showDiagram && (
        <FramingDiagram major={target.angular_major_arcmin} minor={target.angular_minor_arcmin} fovDeg={fovDeg} size={size} />
      )}
      {hasImage && src && (
        <img
          src={src}
          alt={`Digitized Sky Survey image of ${target.name}`}
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
    </div>
  );
}
