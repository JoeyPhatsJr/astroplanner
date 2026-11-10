/** Night-vision mode lives on <html data-vision>, so CSS variables switch the whole palette at once. */
export type Vision = "normal" | "night";

const THEME_COLOR: Record<Vision, string> = { normal: "#02030a", night: "#050000" };

function set(nightVision: boolean): void {
  const v: Vision = nightVision ? "night" : "normal";
  document.documentElement.dataset.vision = v;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[v]);
}

/**
 * Applies the palette. The first paint (index.html and initial prefs) must stay instant; only a
 * user's switch passes `animate`. Leaving night vision crossfades over 200 ms via a view transition
 * (when supported and motion is not reduced) to soften the brightness jump. Entering night vision is
 * always instant: a crossfade would show non-red pixels.
 */
export function applyVision(nightVision: boolean, opts: { animate?: boolean } = {}): void {
  try {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (opts.animate && !nightVision && !reduced && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => set(nightVision));
    } else {
      set(nightVision);
    }
  } catch {
    /* no DOM (tests without jsdom): nothing to do */
  }
}
