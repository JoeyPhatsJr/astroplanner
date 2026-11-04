import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, BASE, detailMessage, request } from "./client";
import { qk } from "./hooks";

// Mirrors backend/app/processing (routes.run_out, steps.StepView, rules.Advice).

export type StepId =
  | "report"
  | "convert"
  | "align"
  | "select"
  | "stack"
  | "background"
  | "colour"
  | "stretch"
  | "finish"
  | "compare";

export type Basis = "measured" | "siril-docs" | "tutorial-default" | "taste";

export interface Advice {
  rule_id: string;
  setting: string;
  why: string;
  basis: Basis;
  heuristic: boolean;
  source_url: string | null;
}

export interface StepView {
  id: StepId;
  n: number;
  title: string;
  does: string;
  advice: Advice[];
  gui: string;
  command: string | null;
  expect: string | null;
  state: "todo" | "done";
  blocked: string | null;
}

export interface ReportBin {
  start_utc: string;
  label_local: string;
  captured: number;
  aligned: number;
  kept: number | null;
}

export interface ReportFinding {
  id: string;
  title: string;
  detail: string;
  basis: Basis;
  heuristic: boolean;
  value?: number | null;
}

export interface ReportTotals {
  captured: number;
  aligned: number;
  kept: number | null;
  captured_s: number;
  aligned_s: number;
  kept_s: number | null;
  matched: number;
  unmatched: number;
}

export interface NightReportData {
  totals: ReportTotals;
  medians: Record<string, number | null>;
  ranges: Record<string, number[] | null>;
  bins: ReportBin[];
  findings: ReportFinding[];
  time_unknown: number;
  timezone: string | null;
  units: Record<string, string>;
}

export interface FolderInfo {
  run_dir: string;
  registration_seq: string;
  kept_seq: string | null;
  seq_version: number;
  matched: number;
  kept_error: string | null;
  calibration_dirs: string[];
}

export interface SirilFolderBody {
  run_dir: string;
  files: { path: string; text: string }[];
  calibration_dirs: string[];
}

export interface SelectionOption {
  id: string;
  label: string;
  filter: "none" | "round" | "wfwhm";
  value: number | null;
  percent: number | null;
  kept: number;
  seconds: number;
  basis: Basis;
  heuristic: boolean;
  note: string;
}

export interface LastChoice {
  night_date: string;
  target_name: string;
  option_label: string;
  kept: number;
}

export type ScriptKind = "prepare" | "stack";

export interface ScriptsInfo {
  prepare_bytes: number; // disk the prepare script writes (debayered copy of every frame)
  stack_max_bytes: number; // the most the stack script can add: an aligned copy of every frame
  stack_bytes: number | null; // extra disk the stack script writes; null until frames are chosen
  stack_blocked: string | null; // why the stack script can't be downloaded yet
}

export interface RunOut {
  id: string;
  capture_set_id: string;
  target: { id: string; name: string };
  night: { session_id: string; night_date: string; timezone: string | null };
  frames: number;
  exptime_s: number | null;
  steps: StepView[];
  report: NightReportData | null;
  folder?: FolderInfo | null;
  selection: SelectionOption[];
  selection_last_time?: LastChoice | null;
  choices?: { selection?: string; filter?: string };
  selection_cleared?: boolean; // only on a folder-upload response
  comparison: Record<string, unknown>;
  siril_target: string;
  scripts?: ScriptsInfo;
}

export interface RunPatch {
  step_states?: Partial<Record<StepId, "todo" | "done">>;
  choices?: Record<string, unknown>;
}

export const processingApi = {
  uploadFolder: (id: string, body: SirilFolderBody) =>
    request<RunOut>(`/api/processing/runs/${encodeURIComponent(id)}/siril-folder`, { method: "POST", body: JSON.stringify(body) }),
  startRun: (captureSetId: string) =>
    request<RunOut>("/api/processing/runs", { method: "POST", body: JSON.stringify({ capture_set_id: captureSetId }) }),
  run: (id: string) => request<RunOut>(`/api/processing/runs/${encodeURIComponent(id)}`),
  patchRun: (id: string, body: RunPatch) =>
    request<RunOut>(`/api/processing/runs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
};

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: processingApi.startRun,
    onSuccess: (run) => qc.setQueryData(qk.processingRun(run.id), run),
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: qk.processingRun(runId ?? ""),
    queryFn: () => processingApi.run(runId as string),
    enabled: !!runId,
  });
}

export function usePatchRun(runId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunPatch) => processingApi.patchRun(runId as string, body),
    onSuccess: (run) => qc.setQueryData(qk.processingRun(run.id), run),
  });
}

export function useUploadFolder(runId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SirilFolderBody) => processingApi.uploadFolder(runId as string, body),
    onSuccess: (run) => qc.setQueryData(qk.processingRun(run.id), run),
  });
}

/** Fetch one generated Siril script; the file name is the one the server sends in Content-Disposition. */
export async function fetchScript(runId: string, which: ScriptKind): Promise<{ filename: string; blob: Blob }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/processing/runs/${encodeURIComponent(runId)}/scripts/${which}`);
  } catch {
    throw new ApiError(0, "Cannot reach the AstroPlanner API. Is the backend running on port 8000?");
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new ApiError(res.status, detailMessage(body, res.status));
  }
  const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  if (!m) throw new ApiError(res.status, "The server sent the script without a file name.");
  return { filename: m[1], blob: await res.blob() };
}
