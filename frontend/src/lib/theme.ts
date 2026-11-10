import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "../state/prefs";
import type { SkyBand } from "./sky";
import { VISION_EVENT } from "./vision";

/**
 * Resolved theme colours for SVG chart attributes. Recharts writes colours into SVG
 * presentation attributes, where CSS var() support is inconsistent across browsers,
 * so charts read the computed values instead. Re-read whenever night vision toggles and
 * again on VISION_EVENT, because leaving night vision lands on <html> inside a view
 * transition, after the re-render (see applyVision).
 */
export interface ThemeColors {
  accent: string;
  accentDim: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  panel2: string;
  warn: string;
  sky: Record<SkyBand, string>;
}

// Normal-mode values; used if computed styles are unavailable (e.g. jsdom tests).
const FALLBACK: ThemeColors = {
  accent: "#5aa9ff",
  accentDim: "#3d77ba",
  ink: "#f5f7fa",
  ink2: "#c5ccd6",
  muted: "#8a93a3",
  line: "#232a37",
  panel2: "#121722",
  warn: "#f0a35e",
  sky: { day: "#1b2539", civil: "#141c2c", nautical: "#0e1421", astronomical: "#090d17", dark: "#04060c" },
};

export function readThemeColors(): ThemeColors {
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch {
    return FALLBACK;
  }
  const v = (name: string, fb: string) => cs?.getPropertyValue(name).trim() || fb;
  return {
    accent: v("--color-ice", FALLBACK.accent),
    accentDim: v("--color-ice-dim", FALLBACK.accentDim),
    ink: v("--color-ink", FALLBACK.ink),
    ink2: v("--color-ink-2", FALLBACK.ink2),
    muted: v("--color-muted", FALLBACK.muted),
    line: v("--color-line", FALLBACK.line),
    panel2: v("--color-panel-2", FALLBACK.panel2),
    warn: v("--color-warn", FALLBACK.warn),
    sky: {
      day: v("--color-sky-day", FALLBACK.sky.day),
      civil: v("--color-sky-civil", FALLBACK.sky.civil),
      nautical: v("--color-sky-nautical", FALLBACK.sky.nautical),
      astronomical: v("--color-sky-astronomical", FALLBACK.sky.astronomical),
      dark: v("--color-sky-dark", FALLBACK.sky.dark),
    },
  };
}

export function useThemeColors(): ThemeColors {
  const { prefs } = usePrefs();
  // The palette lands on <html> possibly after the re-render (leaving night vision runs in a view
  // transition), so also re-read whenever applyVision reports a change.
  const [applied, setApplied] = useState(0);
  useEffect(() => {
    const on = () => setApplied((n) => n + 1);
    window.addEventListener(VISION_EVENT, on);
    return () => window.removeEventListener(VISION_EVENT, on);
  }, []);
  return useMemo(() => readThemeColors(), [prefs.nightVision, applied]); // eslint-disable-line react-hooks/exhaustive-deps
}
