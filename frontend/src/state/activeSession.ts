import { useMemo, useState } from "react";
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

export function useActiveSession() {
  const { prefs, update } = usePrefs();
  const sessions = useSessions();
  const { nightDate } = useNightDate();
  const { location } = useCurrentLocation();
  const equipment = useCurrentEquipment();
  const m = useSessionMutations();
  const [error, setError] = useState<string | null>(null);

  const session = useMemo(
    () => pickSessionForNight(sessions.data ?? [], prefs.activeSessionId, nightDate),
    [sessions.data, prefs.activeSessionId, nightDate],
  );

  async function addTarget(targetId: string, window?: { start_utc: string; end_utc: string } | null) {
    setError(null);
    if (!nightDate) return;
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
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const inSession = (targetId: string) => !!session?.targets.some((t) => t.target_id === targetId);

  return {
    session,
    sessionsQuery: sessions,
    addTarget,
    inSession,
    isAdding: m.create.isPending || m.addTarget.isPending,
    error,
    mutations: m,
  };
}
