import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  /** How progress is counted, e.g. "Outburst days: … (UT dates)." */
  note?: string;
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

export interface CurveStatus {
  last_ok_utc: string | null;
  last_error: string | null;
  coverage_days: number;
  target_days: number;
  loading: boolean;
}

export interface CurveResponse {
  window: { key: string; label: string; from_date: string | null; to_date: string | null };
  /** [JD, magnitude, band] */
  points: [number, number, string][];
  /** [UT date, mean magnitude, observation count] */
  daily: [string, number, number][];
  counts: { cached: number; plotted_points: number; every_nth: number; included: number };
  bands_included: string[];
  excluded_note: string;
  status: CurveStatus;
  attribution: string[];
  /** AAVSO source on the server: "live" | "fixture" (synthetic test data) | "injected" | "off". */
  mode?: string;
}

export type AlertState = "alert" | "no_change" | "stale" | "unavailable";

export interface SkyAlert {
  star_id: string;
  slug: string;
  name: string;
  state: AlertState;
  evidence: { observers: number; threshold: number; window_hours: number; brightest: number | null };
  current_mag: number | null;
  normal_text: string;
  checked_utc: string | null;
  last_error: string | null;
  visibility: Visibility | null;
}

export interface AlertsResponse {
  enabled: boolean;
  mode?: string;
  alerts: SkyAlert[];
  dot: boolean;
  attribution?: string[];
}

/** Fixture mode serves synthetic CSV files (e2e, demos): never present them as AAVSO observations. */
export const FIXTURE_NOTICE = "Synthetic test data — not AAVSO observations";
const OBS_ATTRIBUTION_PREFIX = "Observations from the AAVSO International Database";

export const isFixtureMode = (mode: string | null | undefined) => mode === "fixture";

/** Attribution lines to show: in fixture mode the AAVSO observations line is dropped (the VSX catalog line is real). */
export function shownAttribution(lines: string[] | undefined, mode: string | null | undefined): string[] {
  return (lines ?? []).filter((l) => !(isFixtureMode(mode) && l.startsWith(OBS_ATTRIBUTION_PREFIX)));
}

const enc = encodeURIComponent;

function query(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  return sp.toString();
}

export const variablesApi = {
  curve: (slug: string, window: string) => request<CurveResponse>(`/api/variables/${enc(slug)}/curve?${query({ window })}`),
  alerts: (o: { lat: number; lon: number; elevation_m?: number | null; date: string; timezone: string }, minAlt: number, darkness: string) =>
    request<AlertsResponse>(
      `/api/variables/alerts?${query({
        lat: o.lat,
        lon: o.lon,
        elevation_m: o.elevation_m ?? 0,
        date: o.date,
        timezone: o.timezone,
        min_altitude_deg: minAlt,
        darkness,
      })}`,
    ),
  dismissAlert: (slug: string) => request<void>(`/api/variables/${enc(slug)}/alerts/dismiss`, { method: "POST" }),
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

export const CURVE_POLL_MS = 5000;

export function useStarCurve(slug: string | undefined, window: string, enabled = true) {
  return useQuery({
    queryKey: ["variables", "curve", slug, window],
    queryFn: () => variablesApi.curve(slug as string, window),
    enabled: enabled && !!slug,
    // The backend fills history in the background; poll for progress only while it says it is loading.
    refetchInterval: (q) => (q.state.status !== "error" && q.state.data?.status.loading ? CURVE_POLL_MS : false),
    refetchOnWindowFocus: false,
  });
}

/** The only AAVSO request made when the app opens (Tonight card and menu dot share this query). */
export function useVariableAlerts() {
  const o = useObserver();
  const { prefs } = usePrefs();
  return useQuery({
    queryKey: ["variables", "alerts", o, prefs.minAltitudeDeg, prefs.darkness],
    queryFn: () => variablesApi.alerts(o!, prefs.minAltitudeDeg, prefs.darkness),
    enabled: !!o,
    staleTime: 10 * 60_000,
  });
}

export function useDismissAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => variablesApi.dismissAlert(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["variables", "alerts"] }),
  });
}

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
