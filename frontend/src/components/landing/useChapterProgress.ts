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
 * Which chapter sits in the middle band of the viewport, and which have been seen.
 * Without IntersectionObserver every chapter counts as seen, so nothing stays dimmed.
 */
export function useChapterProgress(ids: string[]) {
  const supported = typeof window !== "undefined" && "IntersectionObserver" in window;
  const [active, setActive] = useState<string>(ids[0]);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(supported ? [] : ids));
  const nodes = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!supported) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).dataset.chapter;
          if (!id) continue;
          setActive(id);
          setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    nodes.current.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [supported]);

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };

  return { active, seen, register };
}
