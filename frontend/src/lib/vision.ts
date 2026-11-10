/** Night-vision mode lives on <html data-vision>, so CSS variables switch the whole palette at once. */
export type Vision = "normal" | "night";

const THEME_COLOR: Record<Vision, string> = { normal: "#02030a", night: "#050000" };

/** Fired on window after every palette change lands on <html>, so colour readers can re-read. */
export const VISION_EVENT = "astro:vision-applied";

/** The palette the latest request wants. A deferred transition callback applies this, never its own stale value. */
let wanted = false;
let pending: { skipTransition?: () => void } | null = null;

function set(nightVision: boolean): void {
  const v: Vision = nightVision ? "night" : "normal";
  document.documentElement.dataset.vision = v;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[v]);
  window.dispatchEvent(new Event(VISION_EVENT));
}

/**
 * Applies the palette. The first paint (index.html and initial prefs) must stay instant; only a
 * user's switch passes `animate`. Leaving night vision crossfades over 200 ms via a view transition
 * (when supported and motion is not reduced) to soften the brightness jump. Entering night vision is
 * always instant: a crossfade would show non-red pixels. The transition's update callback runs
 * asynchronously, so it applies the latest wanted palette and a later toggle always wins; readers
 * of computed colours listen for VISION_EVENT.
 */
export function applyVision(nightVision: boolean, opts: { animate?: boolean } = {}): void {
  try {
    wanted = nightVision;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { skipTransition?: () => void } | undefined };
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (opts.animate && !nightVision && !reduced && typeof doc.startViewTransition === "function") {
      pending?.skipTransition?.();
      pending = doc.startViewTransition(() => set(wanted)) ?? null;
    } else {
      pending?.skipTransition?.();
      pending = null;
      set(nightVision);
    }
  } catch {
    /* no DOM (tests without jsdom): nothing to do */
  }
}
