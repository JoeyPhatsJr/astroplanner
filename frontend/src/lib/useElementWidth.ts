import { useEffect, useRef, useState } from "react";

/**
 * Measured content width of an element, so an SVG can be drawn at its real
 * pixel size and its text stays true size. Falls back to `fallback` where
 * nothing is laid out (jsdom) or ResizeObserver is missing.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 752): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
