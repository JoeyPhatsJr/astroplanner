import { useQuery } from "@tanstack/react-query";
import { request } from "./client";
import { useCurrentEquipment, useObserver } from "./hooks";
import { usePrefs } from "../state/prefs";
import type { NightSummary, Visibility } from "./types";

export interface VariableStarView {
  id: string;
  slug?: string;
  primary_designation: string;
  name: string;
  category: string;
  kind: string;
  constellation: string;
  ra_deg: number;
  dec_deg: number;
}

export interface VsxFacts {
  max_mag: number | null;
  min_mag: number | null;
  band: string | null;
  raw_range: string[];
  [key: string]: unknown;
}

export interface AavsoInfo {
  enabled: boolean;
  mode: string;
}

export interface VariableListItem extends VariableStarView {
  slug: string;
  type_label: string;
  vsx: VsxFacts;
  nights_count: number;
  alert: unknown | null;
}

export interface VariablesResponse {
  aavso: AavsoInfo;
  stars: VariableListItem[];
}

export interface Mission {
  key: string;
  title: string;
  description: string;
  progress: number;
  goal: number | null;
  unit: string;
  available: boolean;
  reason?: string;
}

export interface SeestarFit {
  estimate_range: [number, number];
  label: string;
  text: string;
}

export interface StarResponse {
  star: VariableStarView;
  vsx: VsxFacts;
  type_label: string;
  period_note: string | null;
  source_url: string;
  retrieved: string;
  attribution: string[];
  nights: string[];
  missions: Mission[];
  seestar_fit: SeestarFit | null;
  aavso: AavsoInfo & { fallback_link: string };
}

export interface StarVisibilityResponse {
  computed_at_utc: string;
  star: VariableStarView;
  visibility: Visibility;
  night: Pick<NightSummary, "timezone" | "night_date" | "has_darkness" | "notes">;
}

const enc = encodeURIComponent;

function query(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  return sp.toString();
}

export const variablesApi = {
  list: (timezone?: string | null) => request<VariablesResponse>(`/api/variables?${query({ timezone })}`),
  star: (slug: string, equipmentId?: string | null, timezone?: string | null) =>
    request<StarResponse>(`/api/variables/${enc(slug)}?${query({ equipment_id: equipmentId, timezone })}`),
  visibility: (slug: string, o: { lat: number; lon: number; elevation_m?: number | null; date: string; timezone: string }, minAlt: number, darkness: string) =>
    request<StarVisibilityResponse>(
      `/api/variables/${enc(slug)}/visibility?${query({
        lat: o.lat,
        lon: o.lon,
        elevation_m: o.elevation_m ?? 0,
        date: o.date,
        timezone: o.timezone,
        min_altitude_deg: minAlt,
        darkness,
      })}`,
    ),
};

export function useVariables() {
  const o = useObserver();
  const tz = o?.timezone ?? null;
  return useQuery({ queryKey: ["variables", tz], queryFn: () => variablesApi.list(tz), staleTime: 60_000 });
}

export function useStar(slug: string | undefined) {
  const o = useObserver();
  const eq = useCurrentEquipment();
  const tz = o?.timezone ?? null;
  return useQuery({
    queryKey: ["variables", "star", slug, eq?.id ?? null, tz],
    queryFn: () => variablesApi.star(slug as string, eq?.id ?? null, tz),
    enabled: !!slug,
    staleTime: 60_000,
  });
}

export function useStarVisibility(slug: string | undefined) {
  const o = useObserver();
  const { prefs } = usePrefs();
  return useQuery({
    queryKey: ["variables", "visibility", slug, o, prefs.minAltitudeDeg, prefs.darkness],
    queryFn: () => variablesApi.visibility(slug as string, o!, prefs.minAltitudeDeg, prefs.darkness),
    enabled: !!o && !!slug,
    staleTime: 5 * 60_000,
  });
}
