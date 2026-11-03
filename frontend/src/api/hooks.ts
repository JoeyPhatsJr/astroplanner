import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { defaultNightDate } from "../lib/time";
import { usePrefs } from "../state/prefs";
import { api, type ObserverParams } from "./client";
import type { Category, EquipmentProfile, ObservingLocation, ObservingSession } from "./types";

export const qk = {
  locations: ["locations"] as const,
  equipment: ["equipment"] as const,
  sessions: ["sessions"] as const,
  about: ["about"] as const,
  processingRun: (id: string) => ["processing-run", id] as const,
};

export function useLocations() {
  return useQuery({ queryKey: qk.locations, queryFn: api.locations, staleTime: 60_000 });
}

export function useEquipmentList() {
  return useQuery({ queryKey: qk.equipment, queryFn: api.equipment, staleTime: 60_000 });
}

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: api.sessions });
}

export function useAbout() {
  return useQuery({ queryKey: qk.about, queryFn: api.about, staleTime: Infinity });
}

/** The selected location (falls back to the first saved one). */
export function useCurrentLocation(): {
  location: ObservingLocation | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { prefs } = usePrefs();
  const q = useLocations();
  const location = useMemo(() => {
    const list = q.data ?? [];
    return list.find((l) => l.id === prefs.locationId) ?? list[0] ?? null;
  }, [q.data, prefs.locationId]);
  return { location, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useCurrentEquipment(): EquipmentProfile | null {
  const { prefs } = usePrefs();
  const q = useEquipmentList();
  return useMemo(() => {
    const list = q.data ?? [];
    return list.find((e) => e.id === prefs.equipmentId) ?? list[0] ?? null;
  }, [q.data, prefs.equipmentId]);
}

/** Night date in effect: the user's explicit choice, else the default night for the location. */
export function useNightDate(): { nightDate: string | null; isAuto: boolean } {
  const { prefs } = usePrefs();
  const { location } = useCurrentLocation();
  if (prefs.nightDate) return { nightDate: prefs.nightDate, isAuto: false };
  if (!location) return { nightDate: null, isAuto: true };
  return { nightDate: defaultNightDate(Date.now(), location.timezone), isAuto: true };
}

export function useObserver(): ObserverParams | null {
  const { location } = useCurrentLocation();
  const { nightDate } = useNightDate();
  return useMemo(() => {
    if (!location || !nightDate) return null;
    return {
      lat: location.latitude_deg,
      lon: location.longitude_deg,
      elevation_m: location.elevation_m,
      date: nightDate,
      timezone: location.timezone,
    };
  }, [location, nightDate]);
}

export function useTonight() {
  const o = useObserver();
  const { prefs } = usePrefs();
  return useQuery({
    queryKey: ["tonight", o, prefs.darkness],
    queryFn: () => api.tonight(o!, prefs.darkness),
    enabled: !!o,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useRecommendations(filters: { category?: Category; query?: string } = {}) {
  const o = useObserver();
  const { prefs } = usePrefs();
  const opts = {
    equipment_id: prefs.equipmentId,
    min_altitude_deg: prefs.minAltitudeDeg,
    darkness: prefs.darkness,
    category: filters.category ?? "all",
    query: filters.query?.trim() || undefined,
  };
  return useQuery({
    queryKey: ["recommendations", o, opts],
    queryFn: () => api.recommendations(o!, opts),
    enabled: !!o,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useVisibility(targetId: string | null) {
  const o = useObserver();
  const { prefs } = usePrefs();
  const opts = { equipment_id: prefs.equipmentId, min_altitude_deg: prefs.minAltitudeDeg, darkness: prefs.darkness };
  return useQuery({
    queryKey: ["visibility", targetId, o, opts],
    queryFn: () => api.visibility(targetId!, o!, opts),
    enabled: !!o && !!targetId,
    staleTime: 5 * 60_000,
  });
}

/** Session mutations update the sessions cache from the server response. */
export function useSessionMutations() {
  const qc = useQueryClient();
  const put = (s: ObservingSession) => {
    qc.setQueryData<ObservingSession[]>(qk.sessions, (old) => {
      if (!old) return [s];
      const i = old.findIndex((x) => x.id === s.id);
      if (i === -1) return [s, ...old];
      const next = old.slice();
      next[i] = s;
      return next;
    });
  };
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.sessions });
  return {
    create: useMutation({ mutationFn: api.createSession, onSuccess: put }),
    update: useMutation({
      mutationFn: (v: { id: string; body: Parameters<typeof api.updateSession>[1] }) => api.updateSession(v.id, v.body),
      onSuccess: put,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteSession(id), onSuccess: invalidate }),
    addTarget: useMutation({
      mutationFn: (v: { id: string; target_id: string; planned_start_utc?: string | null; planned_end_utc?: string | null }) =>
        api.addSessionTarget(v.id, { target_id: v.target_id, planned_start_utc: v.planned_start_utc, planned_end_utc: v.planned_end_utc }),
      onSuccess: put,
    }),
    removeTarget: useMutation({
      mutationFn: (v: { id: string; stId: string }) => api.removeSessionTarget(v.id, v.stId),
      onSuccess: put,
    }),
    reorder: useMutation({
      mutationFn: (v: { id: string; ids: string[] }) => api.reorderSessionTargets(v.id, v.ids),
      onSuccess: put,
    }),
  };
}
