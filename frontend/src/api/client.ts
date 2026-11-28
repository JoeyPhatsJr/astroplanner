import type {
  AboutResponse,
  Category,
  Darkness,
  EquipmentInput,
  EquipmentProfile,
  GeocodeResult,
  LocationInput,
  ObservingLocation,
  ObservingSession,
  RecommendationsResponse,
  SessionStatus,
  Target,
  TonightResponse,
  VisibilityResponse,
} from "./types";

import { forecastClientId, relayBrowserForecast, waitForRelay } from "./browserForecast";

export const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The API answered 404: the thing asked for is not there, or does not belong to this account. */
export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

export function detailMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((e) => (e && typeof e === "object" && "msg" in e ? String((e as { msg: unknown }).msg) : String(e)))
        .join("; ");
    }
  }
  // No JSON detail usually means a proxy or the host answered, not the API itself.
  if (status === 413) return "That file is too large for this server.";
  if (status === 429) return "The server is getting too many requests right now. Try again in a minute.";
  if (status === 502 || status === 503 || status === 504) return "The server is starting up or busy. Try again in a minute.";
  if (status >= 500) return "Something went wrong on the AstroPlanner server. Try again in a few minutes.";
  return `Request failed (HTTP ${status})`;
}

/** Shown when fetch itself fails (no response at all). */
export const UNREACHABLE = import.meta.env.DEV
  ? "Cannot reach the AstroPlanner API. Is the backend running on port 8000?"
  : "Cannot reach the AstroPlanner server. Check your connection and try again.";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      // the session cookie rides along; accounts need the same-origin dev proxy (VITE_API_BASE cross-origin is unsupported)
      credentials: "same-origin",
      headers: {
        // multipart bodies need the browser to set the boundary itself
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
        // the backend refuses state-changing /api/ requests without it (cross-site request guard)
        "X-Requested-With": "AstroPlanner",
      },
    });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(res.status, detailMessage(body, res.status));
  return body as T;
}

export interface LimitsResponse {
  max_upload_mb: number;
}

let limitsPromise: Promise<LimitsResponse> | null = null;

/** The server's upload limit (a hosted deploy may set it below the local 150 MB). Fetched once; a failure retries next call. */
export function fetchLimits(): Promise<LimitsResponse> {
  if (!limitsPromise) {
    limitsPromise = request<LimitsResponse>("/api/limits").catch((e: unknown) => {
      limitsPromise = null;
      throw e;
    });
  }
  return limitsPromise;
}

/** For tests: forget the cached limits. */
export function resetLimitsCache(): void {
  limitsPromise = null;
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

/** Refuse a file over the server's limit before sending it; the server still checks. An unknown limit lets it through. */
export async function assertUploadSize(file: File): Promise<void> {
  let limitMb: number;
  try {
    limitMb = (await fetchLimits()).max_upload_mb;
  } catch {
    return;
  }
  if (file.size > limitMb * 1024 * 1024) {
    throw new ApiError(413, `${file.name} is ${megabytes(file.size)} MB; this server accepts files up to ${limitMb} MB.`);
  }
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export interface ObserverParams {
  lat: number;
  lon: number;
  elevation_m?: number | null;
  date: string;
  timezone: string;
}

function observerQuery(o: ObserverParams) {
  return { lat: o.lat, lon: o.lon, elevation_m: o.elevation_m ?? 0, date: o.date, timezone: o.timezone };
}

const json = (body: unknown) => JSON.stringify(body);

/**
 * Requests whose answer uses the night's forecast: first let this browser fetch the forecast from Open-Meteo
 * and relay it (see browserForecast.ts), then ask the API with this browser's id so it uses that forecast.
 * The wait is capped; a relay that lands later refreshes these queries (useLateForecastRefresh).
 */
async function withForecast<T>(o: ObserverParams, path: string): Promise<T> {
  const headers = { "X-Forecast-Client": forecastClientId() };
  await waitForRelay(
    relayBrowserForecast(o, (body) =>
      request(`/api/forecast/relay?${qs(observerQuery(o))}`, { method: "POST", body, headers }),
    ),
  );
  return request<T>(path, { headers });
}

export const api = {
  tonight: (o: ObserverParams, darkness: Darkness) =>
    withForecast<TonightResponse>(o, `/api/tonight?${qs({ ...observerQuery(o), darkness })}`),

  recommendations: (
    o: ObserverParams,
    opts: { equipment_id?: string | null; min_altitude_deg: number; darkness: Darkness; category?: Category; query?: string },
  ) => withForecast<RecommendationsResponse>(o, `/api/recommendations?${qs({ ...observerQuery(o), ...opts })}`),

  visibility: (
    targetId: string,
    o: ObserverParams,
    opts: { equipment_id?: string | null; min_altitude_deg: number; darkness: Darkness },
  ) => withForecast<VisibilityResponse>(o, `/api/targets/${encodeURIComponent(targetId)}/visibility?${qs({ ...observerQuery(o), ...opts })}`),

  target: (id: string) => request<Target>(`/api/targets/${encodeURIComponent(id)}`),

  about: () => request<AboutResponse>("/api/about"),

  geocode: (q: string) => request<{ results: GeocodeResult[]; source: string }>(`/api/geocode?${qs({ q })}`),
  timezoneAt: (lat: number, lon: number) =>
    request<{ timezone: string | null; source: string }>(`/api/timezone?${qs({ lat, lon })}`),

  locations: () => request<ObservingLocation[]>("/api/locations"),
  createLocation: (body: LocationInput) => request<ObservingLocation>("/api/locations", { method: "POST", body: json(body) }),
  updateLocation: (id: string, body: Partial<LocationInput>) =>
    request<ObservingLocation>(`/api/locations/${id}`, { method: "PATCH", body: json(body) }),
  deleteLocation: (id: string) => request<void>(`/api/locations/${id}`, { method: "DELETE" }),

  equipment: () => request<EquipmentProfile[]>("/api/equipment"),
  createEquipment: (body: EquipmentInput) => request<EquipmentProfile>("/api/equipment", { method: "POST", body: json(body) }),
  updateEquipment: (id: string, body: Partial<EquipmentInput>) =>
    request<EquipmentProfile>(`/api/equipment/${id}`, { method: "PATCH", body: json(body) }),
  duplicateEquipment: (id: string) => request<EquipmentProfile>(`/api/equipment/${id}/duplicate`, { method: "POST" }),
  deleteEquipment: (id: string) => request<void>(`/api/equipment/${id}`, { method: "DELETE" }),

  sessions: () => request<ObservingSession[]>("/api/sessions"),
  session: (id: string) => request<ObservingSession>(`/api/sessions/${id}`),
  createSession: (body: { title: string; local_night_date: string; location_id?: string | null; equipment_id?: string | null; notes?: string | null }) =>
    request<ObservingSession>("/api/sessions", { method: "POST", body: json(body) }),
  updateSession: (id: string, body: Partial<{ title: string; notes: string | null; status: SessionStatus; local_night_date: string }>) =>
    request<ObservingSession>(`/api/sessions/${id}`, { method: "PATCH", body: json(body) }),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  addSessionTarget: (id: string, body: { target_id: string; planned_start_utc?: string | null; planned_end_utc?: string | null }) =>
    request<ObservingSession>(`/api/sessions/${id}/targets`, { method: "POST", body: json(body) }),
  removeSessionTarget: (id: string, stId: string) =>
    request<ObservingSession>(`/api/sessions/${id}/targets/${stId}`, { method: "DELETE" }),
  reorderSessionTargets: (id: string, ids: string[]) =>
    request<ObservingSession>(`/api/sessions/${id}/targets/order`, { method: "PUT", body: json({ session_target_ids: ids }) }),
};
