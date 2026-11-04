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
  prompt?: string | null; // an invitation to add a file for measured advice (steps 6-8 without a Siril stack)
}

export type StackSide = "siril" | "seestar";

/** Everything measure.py reports for a finished stack; null = not in the file (or too few stars). */
export interface CompareMeasurement {
  width: number;
  height: number;
  bayer: string | null; // set when the stack is a raw Bayer image measured on 2x2 super-pixels
  stack_count: number | null;
  livetime_s: number | null;
  star_fwhm_px: number | null;
  stars_measured: number;
  noise_frac: number;
  method: string;
}

export interface ComparisonStack {
  preview_url: string;
  source_filename: string;
  measurement: CompareMeasurement;
}

export interface ComparisonOut {
  mode_available: { pictures: boolean; stacks: boolean };
  seestar_picture: {
    preview_url: string;
    source_filename: string;
    width: number;
    height: number;
    edited: boolean | null;
    edited_by: string | null;
  } | null;
  final_picture: { id: string; source_filename: string; format: string; width: number; height: number; preview_url: string } | null;
  siril_stack: ComparisonStack | null;
  seestar_stack: ComparisonStack | null;
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

/** Which Siril folder the step-4 counts were read from. Script 2 always works in `script_dir` (process-coach);
 *  when the counts come from another folder, `note` says so wherever counts meet script 2. */
export interface SelectionCounts {
  run_dir: string;
  script_dir: string;
  differs: boolean;
  note: string | null;
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
  selection_counts?: SelectionCounts | null;
  choices?: { selection?: string; filter?: string };
  selection_cleared?: boolean; // only on a folder-upload response
  comparison: ComparisonOut; // the only public shape: previews by URL, no storage keys
  siril_target: string;
  scripts?: ScriptsInfo;
}

export interface RunPatch {
  step_states?: Partial<Record<StepId, "todo" | "done">>;
  choices?: Record<string, unknown>;
  comparison?: { seestar_picture: { edited: boolean | null } };
}

export const processingApi = {
  uploadStack: (id: string, side: StackSide, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<RunOut>(`/api/processing/runs/${encodeURIComponent(id)}/stacks/${side}`, { method: "POST", body: fd });
  },
  uploadPicture: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<RunOut>(`/api/processing/runs/${encodeURIComponent(id)}/pictures/seestar`, { method: "POST", body: fd });
  },
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

export function useUploadStack(runId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { side: StackSide; file: File }) => processingApi.uploadStack(runId as string, v.side, v.file),
    onSuccess: (run) => qc.setQueryData(qk.processingRun(run.id), run),
  });
}

export function useUploadPicture(runId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => processingApi.uploadPicture(runId as string, file),
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
