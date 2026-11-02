import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Darkness } from "../api/types";
import { applyVision } from "../lib/vision";

export interface Prefs {
  locationId: string | null;
  equipmentId: string | null;
  /** Explicitly chosen night (YYYY-MM-DD); null means "use the default night for the location". */
  nightDate: string | null;
  minAltitudeDeg: number;
  darkness: Darkness;
  activeSessionId: string | null;
  /** Dim red display to preserve dark adaptation at the telescope. */
  nightVision: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  locationId: null,
  equipmentId: "seestar-s30",
  nightDate: null,
  minAltitudeDeg: 30,
  darkness: "astronomical",
  activeSessionId: null,
  nightVision: false,
};

const STORAGE_KEY = "astroplanner.prefs.v1";

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode); preferences stay in memory */
  }
}

interface PrefsCtx {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function PrefsProvider({ children, initial }: { children: ReactNode; initial?: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = initial ?? loadPrefs();
    applyVision(p.nightVision);
    return p;
  });
  const update = useCallback((patch: Partial<Prefs>) => {
    // Apply before re-render so components reading computed colours see the new palette.
    if (patch.nightVision !== undefined) applyVision(patch.nightVision);
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrefs must be used inside PrefsProvider");
  return v;
}
