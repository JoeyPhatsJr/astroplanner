import { useEffect, useRef, useState } from "react";
import type { Sky } from "./content";

const SKY_VAR: Record<Sky, string> = {
  civil: "var(--color-sky-civil)",
  nautical: "var(--color-sky-nautical)",
  astronomical: "var(--color-sky-astronomical)",
  dark: "var(--color-sky-dark)",
};

/**
 * Paint the page sky behind the landing page and restore it on the way out.
 * The colour goes on <body>, under the app's fixed starfield, so the stars stay visible on top of it.
 */
export function usePageSky(sky: Sky) {
  useEffect(() => {
    document.body.classList.add("landing-sky");
    return () => {
      document.body.classList.remove("landing-sky");
      document.body.style.removeProperty("background-color");
    };
  }, []);
  useEffect(() => {
    document.body.style.backgroundColor = SKY_VAR[sky];
  }, [sky]);
}

/**
 * Index of the active chapter: the last one whose top has passed the middle of the viewport, else the
 * first. Derived from live positions, so it stays right however the reader gets there (wheel, keyboard,
 * a jump back to the top, an anchor link).
 */
export function activeIndex(tops: number[], viewportHeight: number): number {
  let idx = 0;
  tops.forEach((top, i) => {
    if (top <= viewportHeight / 2) idx = i;
  });
  return idx;
}

/** Which chapter is active, and which have been reached so far (their screenshots stay revealed). */
export function useChapterProgress(ids: string[]) {
  const [active, setActive] = useState(0);
  const [reached, setReached] = useState(0);
  const nodes = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const els = nodes.current.filter((n): n is HTMLElement => n !== null);
    if (els.length === 0) return;
    const measure = () => {
      const i = activeIndex(
        els.map((n) => n.getBoundingClientRect().top),
        window.innerHeight,
      );
      setActive(i);
      setReached((r) => Math.max(r, i));
    };
    measure();
    if (typeof IntersectionObserver === "undefined") return;
    // The root runs from far above the page down to the middle of the viewport, so a chapter intersects it
    // exactly when its top has passed the middle: the same test activeIndex applies. Every change of the
    // active chapter flips at least one chapter's state, so the observer fires for all of them, including a
    // jump from the bottom of the page straight back to the top (a middle-line-only root misses that: no
    // chapter is on the line before or after). Positions are re-read only then, never per scroll frame.
    const io = new IntersectionObserver(measure, { rootMargin: "1000000px 0px -50% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const register = (index: number) => (el: HTMLElement | null) => {
    nodes.current[index] = el;
  };

  return { active: ids[active], seen: (index: number) => index <= reached, register };
}
