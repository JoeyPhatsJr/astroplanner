import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { guestLocation, isGuestId } from "../lib/guestPlace";
import { findMatchingLocation } from "../lib/locationMatch";
import { defaultNightDate } from "../lib/time";
import { usePrefs } from "../state/prefs";
import { useAuthStatus } from "./auth";
import { onLateForecast } from "./browserForecast";
import { api, fetchLimits, type ObserverParams } from "./client";
import type { Category, EquipmentProfile, ObservingLocation, ObservingSession } from "./types";

export const qk = {
  locations: ["locations"] as const,
  equipment: ["equipment"] as const,
  sessions: ["sessions"] as const,
  about: ["about"] as const,
  limits: ["limits"] as const,
  processingRun: (id: string) => ["processing-run", id] as const,
};

/** Answers given before this browser's forecast arrived refetch once it does (see browserForecast.ts). */
export function useLateForecastRefresh(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      onLateForecast(() => {
        for (const root of ["tonight", "recommendations", "visibility"]) void qc.invalidateQueries({ queryKey: [root] });
      }),
    [qc],
  );
}

export function useLocations() {
  return useQuery({ queryKey: qk.locations, queryFn: api.locations, staleTime: 60_000 });
}

export function useEquipmentList() {
  return useQuery({ queryKey: qk.equipment, queryFn: api.equipment, staleTime: 60_000 });
}

/** The signed-in user's plans and nights. Never requested signed out, or while the account is still loading. */
export function useSessions() {
  const signedIn = useAuthStatus() === "signedIn";
  return useQuery({ queryKey: qk.sessions, queryFn: api.sessions, enabled: signedIn });
}

export function useAbout() {
  return useQuery({ queryKey: qk.about, queryFn: api.about, staleTime: Infinity });
}

/** Server limits such as the upload size, which a hosted deploy may lower. */
export function useLimits() {
  return useQuery({ queryKey: qk.limits, queryFn: fetchLimits, staleTime: Infinity });
}

/**
 * The selected location. The browser-only guest place (lib/guestPlace.ts) when it is chosen, or when the chosen
 * saved place is not in the list (for example someone's own place after they signed out); then the first place
 * in the list (the sample, signed out). While the list loads, a chosen guest place is already available.
 */
export function useCurrentLocation(): {
  location: ObservingLocation | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { prefs } = usePrefs();
  const q = useLocations();
  const guest = useMemo(() => (prefs.guestPlace ? guestLocation(prefs.guestPlace) : null), [prefs.guestPlace]);
  const guestChosen = !!guest && isGuestId(prefs.locationId);
  const location = useMemo(() => {
    if (guestChosen) return guest;
    if (!q.data) return q.isError ? guest : null; // still loading: wait, rather than flash another place
    return q.data.find((l) => l.id === prefs.locationId) ?? guest ?? q.data[0] ?? null;
  }, [guestChosen, guest, q.data, q.isError, prefs.locationId]);
  return {
    location,
    isLoading: !guestChosen && q.isLoading,
    error: location ? null : q.error,
    refetch: () => void q.refetch(),
  };
}

export function useCurrentEquipment(): EquipmentProfile | null {
  const { prefs } = usePrefs();
  const q = useEquipmentList();
  return useMemo(() => {
    const list = q.data ?? [];
    return list.find((e) => e.id === prefs.equipmentId) ?? list[0] ?? null;
  }, [q.data, prefs.equipmentId]);
}

/**
 * The equipment id planning requests send: the profile actually in use, never the raw preference (which can be
 * another account's private profile after a sign-out, and would answer 404). `ready` once the list has answered.
 */
function useEquipmentParam(): { equipmentId: string | null; ready: boolean } {
  const q = useEquipmentList();
  const eq = useCurrentEquipment();
  return { equipmentId: eq?.id ?? null, ready: q.data !== undefined || q.isError };
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
  const { equipmentId, ready } = useEquipmentParam();
  const opts = {
    equipment_id: equipmentId,
    min_altitude_deg: prefs.minAltitudeDeg,
    darkness: prefs.darkness,
    category: filters.category ?? "all",
    query: filters.query?.trim() || undefined,
  };
  const q = useQuery({
    queryKey: ["recommendations", o, opts],
    queryFn: () => api.recommendations(o!, opts),
    enabled: !!o && ready,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  // Waiting for the equipment list reads as loading, so pages show their skeleton rather than nothing.
  return { ...q, isLoading: q.isLoading || (!!o && !ready && q.data === undefined) };
}

export function useVisibility(targetId: string | null) {
  const o = useObserver();
  const { prefs } = usePrefs();
  const { equipmentId, ready } = useEquipmentParam();
  const opts = { equipment_id: equipmentId, min_altitude_deg: prefs.minAltitudeDeg, darkness: prefs.darkness };
  const q = useQuery({
    queryKey: ["visibility", targetId, o, opts],
    queryFn: () => api.visibility(targetId!, o!, opts),
    enabled: !!o && !!targetId && ready,
    staleTime: 5 * 60_000,
  });
  return { ...q, isLoading: q.isLoading || (!!o && !!targetId && !ready && q.data === undefined) };
}

/**
 * "Save to my account" for the browser-only guest place (signed in). Reuses one of the user's own places at the
 * same spot (within ~1 km) instead of saving a second. The saved place becomes the current one, and the browser
 * copy is dropped: it lives on the account now.
 */
export function useSaveGuestPlace() {
  const qc = useQueryClient();
  const { prefs, update } = usePrefs();
  return useMutation({
    mutationFn: async (): Promise<ObservingLocation> => {
      const p = prefs.guestPlace;
      if (!p) throw new Error("There is no place in this browser to save.");
      const own = (await qc.fetchQuery({ queryKey: qk.locations, queryFn: api.locations, staleTime: 0 })).filter((l) => !l.is_sample);
      return findMatchingLocation(own, { latitude: p.latitude_deg, longitude: p.longitude_deg }) ?? (await api.createLocation(p));
    },
    onSuccess: async (saved) => {
      // Into the list first, so switching to it never shows another place while the list refetches.
      qc.setQueryData<ObservingLocation[]>(qk.locations, (old) => (old && !old.some((l) => l.id === saved.id) ? [...old, saved] : old));
      update({ locationId: saved.id, guestPlace: null });
      await qc.invalidateQueries({ queryKey: qk.locations }).catch(() => undefined);
    },
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
