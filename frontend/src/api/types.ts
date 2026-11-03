// Types mirror the payloads produced by backend/app/api.py.

export type Darkness = "astronomical" | "nautical";
export type Category = "all" | "galaxy" | "nebula" | "cluster";
export type Basis = "forecast" | "calculated";

export interface Target {
  id: string;
  primary_designation: string;
  name: string;
  aliases: string[];
  category: "galaxy" | "nebula" | "cluster" | "variable";
  kind: string;
  openngc_type: string;
  constellation: string;
  ra_deg: number;
  dec_deg: number;
  coordinate_frame: string;
  epoch: string;
  magnitude: number | null;
  magnitude_band: "V" | "B" | null;
  angular_major_arcmin: number | null;
  angular_minor_arcmin: number | null;
  emission_line_dominant: boolean;
  source: string;
  source_id: string;
  source_url: string;
}

export interface CatalogMeta {
  generated_at_utc: string;
  source: string;
  source_repository: string;
  source_commit: string;
  license: string;
  notes: string;
  count: number;
}

export interface Interval {
  start_utc: string;
  end_utc: string;
}

export interface NightEvents {
  sunset_utc: string | null;
  civil_dusk_utc: string | null;
  nautical_dusk_utc: string | null;
  astronomical_dusk_utc: string | null;
  astronomical_dawn_utc: string | null;
  nautical_dawn_utc: string | null;
  civil_dawn_utc: string | null;
  sunrise_utc: string | null;
}

export interface MoonSummary {
  illumination: number;
  phase_name: string;
  waxing: boolean;
  up_fraction_of_dark: number;
  max_alt_dark_deg: number;
  events: { event: "moonrise" | "moonset"; time_utc: string }[];
  reference_time_utc: string;
}

export interface NightSummary {
  night_date: string;
  timezone: string;
  span_start_utc: string;
  span_end_utc: string;
  span_hours: number;
  display_start_utc: string;
  display_end_utc: string;
  events: NightEvents;
  darkness: Darkness;
  darkness_threshold_deg: number;
  dark_intervals: Interval[];
  dark_minutes: number;
  has_darkness: boolean;
  sun_min_alt_deg: number;
  notes: string[];
  moon: MoonSummary;
  method: Record<string, string | number>;
  series: {
    t_ms: number[];
    sun_alt_deg: number[];
    moon_alt_deg: number[];
    moon_illumination: number[];
  };
}

export interface HourlyRow {
  t_ms: number;
  cloud_cover: number | null;
  cloud_cover_low: number | null;
  cloud_cover_mid: number | null;
  cloud_cover_high: number | null;
  precipitation_probability: number | null;
  precipitation: number | null;
  relative_humidity_2m: number | null;
  dew_point_2m: number | null;
  temperature_2m: number | null;
  wind_speed_10m: number | null;
  visibility: number | null;
}

export interface ForecastPayload {
  status: "ok" | "unavailable" | "error";
  reason_code: string | null;
  message: string | null;
  /** Present when the night is in the past: archived model forecasts, not observations. */
  note?: string;
  source: { provider: string; url: string; terms_url: string; license: string; note: string };
  retrieved_at_utc: string | null;
  from_cache: boolean;
  lead_time_hours: number;
  confidence: { label: "higher" | "moderate" | "low" | "past_or_current"; kind: string; explanation: string };
  grid?: { latitude: number | null; longitude: number | null; elevation_m: number | null };
  hourly: HourlyRow[];
  missing: Record<string, number>;
  units: Record<string, string>;
}

export interface ScoreComponent {
  key: string;
  label: string;
  points: number | null;
  max: number;
  basis: Basis;
  detail: string;
}

export interface TonightScore {
  kind: "heuristic";
  max_total: number;
  darkness: Darkness;
  method: string;
  disclaimer: string;
  status: "ok" | "partial_weather" | "no_weather" | "no_darkness";
  total: number | null;
  partial_total?: number;
  partial_max?: number;
  window: { start_utc: string; end_utc: string; minutes: number } | null;
  components: ScoreComponent[];
  summary: string;
}

export interface TonightResponse {
  computed_at_utc: string;
  night: NightSummary;
  forecast: ForecastPayload;
  score: TonightScore;
}

export type VisibilityStatus =
  | "observable"
  | "too_brief"
  | "daylight_only"
  | "below_threshold"
  | "never_rises"
  | "no_darkness";

export interface Visibility {
  status: VisibilityStatus;
  status_text: string;
  status_detail: string;
  can_observe: boolean;
  min_altitude_deg: number;
  windows: Interval[];
  best_window: (Interval & { minutes: number }) | null;
  observable_minutes: number;
  max_alt_dark_deg: number | null;
  max_alt_dark_utc: string | null;
  culmination_alt_deg: number;
  culmination_utc: string;
  rise_utc: string | null;
  set_utc: string | null;
  circumpolar: boolean;
  never_rises: boolean;
  theoretical_max_alt_deg: number;
  moon_separation_deg: { basis: string; min: number; mean: number; moon_up_fraction: number };
  local_times_tz: string;
  series?: {
    t_ms: number[];
    alt_deg: number[];
    az_deg: number[];
    moon_sep_deg: number[];
    sun_alt_deg: number[];
    moon_alt_deg: number[];
  };
}

export interface TargetScore {
  kind: "heuristic";
  total: number | null;
  max_total: number | null;
  normalized: number | null;
  components: ScoreComponent[];
  why: string[];
  cautions: string[];
  forecast_window: (Interval & { minutes: number; rule: string }) | null;
}

export interface Recommendation {
  target: Target;
  visibility: Visibility;
  score: TargetScore;
  sparkline_alt_deg: number[];
}

export interface RecommendationsResponse {
  computed_at_utc: string;
  params: Record<string, unknown>;
  weather_status: ForecastPayload["status"];
  weather_message: string | null;
  has_darkness: boolean;
  observable_count: number;
  sparkline_t_ms: number[];
  results: Recommendation[];
}

export interface VisibilityResponse {
  computed_at_utc: string;
  target: Target;
  visibility: Visibility & { series: NonNullable<Visibility["series"]> };
  score: TargetScore;
  night: Pick<
    NightSummary,
    "events" | "dark_intervals" | "display_start_utc" | "display_end_utc" | "has_darkness" | "notes" | "moon" | "timezone" | "night_date"
  >;
  weather_status: ForecastPayload["status"];
}

export interface ObservingLocation {
  id: string;
  label: string;
  latitude_deg: number;
  longitude_deg: number;
  elevation_m: number | null;
  timezone: string;
  is_sample: boolean;
  created_at: string;
}

export type LocationInput = Omit<ObservingLocation, "id" | "is_sample" | "created_at">;

export type FovDefinition = "unknown" | "diagonal" | "horizontal" | "vertical";

export interface EquipmentProfile {
  id: string;
  name: string;
  manufacturer: string | null;
  aperture_mm: number | null;
  focal_length_mm: number | null;
  focal_ratio: number | null;
  fov_deg: number | null;
  fov_definition: FovDefinition;
  wide_fov_deg: number | null;
  sensor: string | null;
  mount_type: string | null;
  source_url: string | null;
  notes: string | null;
  is_verified: boolean;
  is_preset: boolean;
  created_at: string;
}

export interface EquipmentInput {
  name: string;
  manufacturer?: string | null;
  aperture_mm?: number | null;
  focal_length_mm?: number | null;
  fov_deg?: number | null;
  fov_definition?: FovDefinition;
  sensor?: string | null;
  mount_type?: string | null;
  notes?: string | null;
}

export type SessionStatus = "planned" | "completed" | "cancelled";

export interface SessionTarget {
  id: string;
  target_id: string;
  sort_order: number;
  planned_start_utc: string | null;
  planned_end_utc: string | null;
  notes: string | null;
  target: Pick<Target, "id" | "primary_designation" | "name" | "category" | "kind" | "constellation" | "ra_deg" | "dec_deg"> | null;
}

export interface ObservingSession {
  id: string;
  title: string;
  location_id: string | null;
  equipment_id: string | null;
  local_night_date: string;
  start_utc: string | null;
  end_utc: string | null;
  status: SessionStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  target_count: number;
  targets: SessionTarget[];
  source?: string;
  capture_sets?: SessionCaptureSet[];
  /** Catalog target ids that were planned but nothing was imported for. */
  not_shot?: string[];
}

export interface SessionCaptureSet {
  library_target_id: string;
  display_name: string;
  device: string;
  frames: number;
  captured_s: number | null;
  first_utc?: string | null;
  last_utc?: string | null;
  exptimes_s?: number[];
}

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  timezone: string | null;
  country_code: string | null;
  population: number | null;
}

export interface AboutResponse {
  data_sources: { name: string; use: string; url: string; license: string; version?: string }[];
  score_weights: { tonight: Record<string, number>; target: Record<string, number> };
  darkness_thresholds_deg: Record<string, number>;
}
