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

export const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
  return `Request failed (HTTP ${status})`;
}

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
    throw new ApiError(0, "Cannot reach the AstroPlanner API. Is the backend running on port 8000?");
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

export const api = {
  tonight: (o: ObserverParams, darkness: Darkness) =>
    request<TonightResponse>(`/api/tonight?${qs({ ...observerQuery(o), darkness })}`),

  recommendations: (
    o: ObserverParams,
    opts: { equipment_id?: string | null; min_altitude_deg: number; darkness: Darkness; category?: Category; query?: string },
  ) => request<RecommendationsResponse>(`/api/recommendations?${qs({ ...observerQuery(o), ...opts })}`),

  visibility: (
    targetId: string,
    o: ObserverParams,
    opts: { equipment_id?: string | null; min_altitude_deg: number; darkness: Darkness },
  ) => request<VisibilityResponse>(`/api/targets/${encodeURIComponent(targetId)}/visibility?${qs({ ...observerQuery(o), ...opts })}`),

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
