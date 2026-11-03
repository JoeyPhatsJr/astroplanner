import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./client";
import { qk } from "./hooks";

// ---- types ----------------------------------------------------------------------------

export interface ImportItem {
  path: string;
  kind: "fits" | "cr2";
  header_b64: string;
  size: number;
}

export interface TargetRef {
  library_key: string;
  catalog_target_id: string | null;
  display_name: string;
  kind: "catalog" | "custom" | "unsorted";
}

export interface PreviewGroup {
  group_key: string;
  is_canon: boolean;
  night_date: string | null;
  device: string;
  target: TargetRef;
  frames: number;
  exptime_s: number | null;
  captured_s: number;
  first_utc: string | null;
  last_utc: string | null;
  filters: string[];
  gains: number[];
  ccd_temp_range: [number, number] | null;
  new_frames: number;
  plan_session_ids: string[];
}

export interface PreviewStack {
  path: string;
  source_filename: string;
  night_date: string | null;
  target: TargetRef;
  stack_count: number | null;
  livetime_s: number | null;
  exptime_s: number | null;
  expstart_jd: number | null;
  expend_jd: number | null;
  program: string | null;
  provenance: "header" | "filename";
  new: boolean;
}

export interface LocationCandidate {
  id: string;
  label: string;
  distance_km: number;
}

export interface SkippedItem {
  path: string;
  reason: string;
}

export interface PreviewResponse {
  needs_location: boolean;
  location_id: string | null;
  location_candidates: LocationCandidate[];
  groups: PreviewGroup[];
  stacks: PreviewStack[];
  skipped: SkippedItem[];
}

export interface PreviewRequest {
  items: ImportItem[];
  location_id?: string | null;
  clock_offset_minutes?: number;
}

export interface CommitRequest extends PreviewRequest {
  plan_session_id?: string | null;
  plan_choices?: Record<string, string>;
  canon_set_names?: Record<string, string>;
  unsorted_groups?: string[];
}

export interface CommitResponse {
  session_ids: string[];
  inserted_frames: number;
  inserted_stacks: number;
  skipped: SkippedItem[];
}

export interface SuggestedLocation {
  latitude_deg: number;
  longitude_deg: number;
  timezone: string | null;
}

export interface Headline {
  seconds: number | null;
  label: "stack" | "captured";
  provenance: string;
  /** Which stack a "stack" headline is: the final picture's linked one, or the latest (stack-only target). */
  basis?: "linked" | "latest" | null;
}

export interface LibraryTargetSummary {
  id: string;
  display_name: string;
  kind: "catalog" | "custom" | "unsorted";
  catalog_target_id: string | null;
  custom_name: string | null;
  category: string | null;
}

export interface LibraryRow extends LibraryTargetSummary {
  thumb_url: string | null;
  headline: Headline;
  captured_s: number | null;
  /** null for a stack-only target: how many nights went into it is unknown. */
  nights: number | null;
}

export interface StackOut {
  id: string;
  source_filename: string;
  stack_count: number | null;
  livetime_s: number | null;
  exptime_s: number | null;
  expstart_jd: number | null;
  expend_jd: number | null;
  program: string | null;
  provenance: string;
  integration_s: number | null;
  integration_provenance: string;
}

export type FinalImageFormat = "JPEG" | "PNG" | "TIFF" | "FITS";

export interface FinalImageOut {
  id: string;
  library_target_id: string;
  stack_id: string | null;
  source_filename: string;
  format: FinalImageFormat;
  width: number;
  height: number;
  is_current: boolean;
  chosen_at: string;
}

export interface TargetFinalImage {
  id: string;
  source_filename: string;
  format: FinalImageFormat;
  width: number;
  height: number;
  stack_id: string | null;
  chosen_at: string;
  preview_url: string;
  thumb_url: string;
}

export interface TargetFact {
  label: string;
  value: string;
  source_key: string;
}

export interface TargetNight {
  session_id: string;
  night_date: string;
  device: string;
  frames: number;
  captured_s: number;
  first_utc: string;
  last_utc: string;
  /** Distinct per-frame exposures in seconds, ascending. */
  exptimes_s: number[];
  /** IANA timezone of the night's location (null when the session has no location). */
  timezone: string | null;
  planned: boolean;
}

export interface TargetPage {
  target: LibraryTargetSummary;
  final_image: TargetFinalImage | null;
  stack: StackOut | null;
  stacks: StackOut[];
  headline: Headline;
  captured_s: number | null;
  frames_total: number;
  percent_used: number | null;
  /** Captured frames inside the linked stack's EXPSTART–EXPEND: the denominator of percent_used. */
  frames_in_stack_range: number | null;
  facts: TargetFact[];
  nights: TargetNight[];
  stack_suggestion_id: string | null;
}

export type History = Record<string, { seconds: number; label: "stack" | "captured"; library_target_id: string }>;

export interface TargetPatch {
  custom_name?: string;
  kind?: "custom" | "unsorted";
}

// ---- client ---------------------------------------------------------------------------

const json = (body: unknown) => JSON.stringify(body);
const enc = encodeURIComponent;

export const astrologApi = {
  previewImport: (body: PreviewRequest) =>
    request<PreviewResponse>("/api/astrolog/import/preview", { method: "POST", body: json(body) }),
  commitImport: (body: CommitRequest) =>
    request<CommitResponse>("/api/astrolog/import/commit", { method: "POST", body: json(body) }),
  suggestLocation: (body: { items: ImportItem[] }) =>
    request<SuggestedLocation>("/api/astrolog/import/suggest-location", { method: "POST", body: json(body) }),
  library: () => request<LibraryRow[]>("/api/astrolog/library"),
  target: (id: string) => request<TargetPage>(`/api/astrolog/targets/${enc(id)}`),
  updateTarget: (id: string, body: TargetPatch) =>
    request<TargetPage>(`/api/astrolog/targets/${enc(id)}`, { method: "PATCH", body: json(body) }),
  history: () => request<History>("/api/astrolog/history"),
  uploadFinalImage: (targetId: string, file: File, stackId?: string | null) => {
    const fd = new FormData();
    fd.append("file", file);
    if (stackId) fd.append("stack_id", stackId);
    return request<FinalImageOut>(`/api/astrolog/targets/${enc(targetId)}/final-image`, { method: "POST", body: fd });
  },
  linkStack: (targetId: string, body: { final_image_id: string; stack_id: string | null }) =>
    request<FinalImageOut>(`/api/astrolog/targets/${enc(targetId)}/stack-link`, { method: "POST", body: json(body) }),
};

// ---- hooks ----------------------------------------------------------------------------

export const alk = {
  library: ["astrolog", "library"] as const,
  history: ["astrolog", "history"] as const,
  target: (id: string) => ["astrolog", "target", id] as const,
};

export function useAstroLogLibrary() {
  return useQuery({ queryKey: alk.library, queryFn: astrologApi.library });
}

export function useAstroLogTarget(id: string | undefined) {
  return useQuery({ queryKey: alk.target(id ?? ""), queryFn: () => astrologApi.target(id as string), enabled: !!id });
}

export function useAstroLogHistory() {
  return useQuery({ queryKey: alk.history, queryFn: astrologApi.history });
}

export function useImportPreview() {
  return useMutation({ mutationFn: astrologApi.previewImport });
}

export function useSuggestLocation() {
  return useMutation({ mutationFn: astrologApi.suggestLocation });
}

export function useImportCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: astrologApi.commitImport,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["astrolog"] });
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

function useInvalidateTarget(targetId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: alk.target(targetId) });
    void qc.invalidateQueries({ queryKey: alk.library });
    void qc.invalidateQueries({ queryKey: alk.history });
  };
}

export function useUploadFinalImage(targetId: string) {
  const done = useInvalidateTarget(targetId);
  return useMutation({
    mutationFn: (v: { file: File; stackId?: string | null }) => astrologApi.uploadFinalImage(targetId, v.file, v.stackId),
    onSuccess: done,
  });
}

export function useLinkStack(targetId: string) {
  const done = useInvalidateTarget(targetId);
  return useMutation({
    mutationFn: (v: { final_image_id: string; stack_id: string | null }) => astrologApi.linkStack(targetId, v),
    onSuccess: done,
  });
}

export function useUpdateLibraryTarget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TargetPatch) => astrologApi.updateTarget(id, body),
    onSuccess: (page) => {
      // Moving to Unsorted merges this target into the Unsorted one and removes it: refresh that one
      // (refetching the removed id would only 404).
      qc.setQueryData(alk.target(page.target.id), page);
      void qc.invalidateQueries({ queryKey: alk.library });
      void qc.invalidateQueries({ queryKey: alk.history });
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}
