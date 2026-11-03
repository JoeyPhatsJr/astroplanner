import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./client";
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

export interface RunOut {
  id: string;
  capture_set_id: string;
  target: { id: string; name: string };
  night: { session_id: string; night_date: string; timezone: string | null };
  frames: number;
  exptime_s: number | null;
  steps: StepView[];
  report: unknown;
  selection: unknown[];
  comparison: Record<string, unknown>;
  siril_target: string;
}

export interface RunPatch {
  step_states?: Partial<Record<StepId, "todo" | "done">>;
  choices?: Record<string, unknown>;
}

export const processingApi = {
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
