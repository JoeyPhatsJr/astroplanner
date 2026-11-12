import { useMemo, useState } from "react";
import { useAuthStatus } from "../api/auth";
import { ApiError } from "../api/client";
import { useCurrentEquipment, useCurrentLocation, useNightDate, useSessionMutations, useSessions } from "../api/hooks";
import type { ObservingSession } from "../api/types";
import { formatCalendarDate } from "../lib/time";
import { usePrefs } from "./prefs";

/** Session used by "Add to session": the active one if it is for the selected night, else any planned one for that night. */
export function pickSessionForNight(sessions: ObservingSession[], activeId: string | null, nightDate: string | null) {
  if (!nightDate) return null;
  const active = sessions.find((s) => s.id === activeId);
  if (active && active.local_night_date === nightDate && active.status === "planned") return active;
  return sessions.find((s) => s.local_night_date === nightDate && s.status === "planned") ?? null;
}

export function sessionTitleForNight(nightDate: string) {
  return `Night of ${formatCalendarDate(nightDate, true).replace(/^\w+ /, "")}`;
}

/**
 * Tonight's plan and "Add to session". Plans belong to an account: signed out (or while the account loads)
 * there is no plan, `addTarget` does nothing, and pages show a sign-in link in place of the Add control.
 */
export function useActiveSession() {
  const { prefs, update } = usePrefs();
  const auth = useAuthStatus();
  const signedIn = auth === "signedIn";
  const sessions = useSessions();
  const { nightDate } = useNightDate();
  const { location } = useCurrentLocation();
  const equipment = useCurrentEquipment();
  const m = useSessionMutations();
  const [error, setError] = useState<string | null>(null);

  // A session that ends mid-use leaves the last list in the cache; it is not shown once signed out.
  const list = signedIn ? sessions.data : undefined;
  const session = useMemo(
    () => pickSessionForNight(list ?? [], prefs.activeSessionId, nightDate),
    [list, prefs.activeSessionId, nightDate],
  );

  async function addTarget(targetId: string, window?: { start_utc: string; end_utc: string } | null) {
    setError(null);
    if (!signedIn || !nightDate) return;
    try {
      let s = session;
      if (!s) {
        s = await m.create.mutateAsync({
          title: sessionTitleForNight(nightDate),
          local_night_date: nightDate,
          location_id: location?.id ?? null,
          equipment_id: equipment?.id ?? null,
        });
      }
      if (prefs.activeSessionId !== s.id) update({ activeSessionId: s.id });
      if (s.targets.some((t) => t.target_id === targetId)) return;
      await m.addTarget.mutateAsync({
        id: s.id,
        target_id: targetId,
        planned_start_utc: window?.start_utc ?? null,
        planned_end_utc: window?.end_utc ?? null,
      });
    } catch (e) {
      // A 401 means the session ended: the account flips to signed out and the sign-in link replaces this control.
      if (e instanceof ApiError && e.status === 401) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const inSession = (targetId: string) => !!session?.targets.some((t) => t.target_id === targetId);

  return {
    /** "loading" while the account query is in flight: show the usual control, disabled, so nothing flashes. */
    auth,
    signedIn,
    session,
    sessionsQuery: sessions,
    addTarget,
    inSession,
    isAdding: m.create.isPending || m.addTarget.isPending,
    error,
    mutations: m,
  };
}
