// Response shapes of our own JSON API, shared by the UI call sites (`api<T>(…)`).
export type IdName = { id: string; name: string };
export type TargetTest = { ok: boolean; ms: number; identity?: string; error?: string };
export type StepResult = {
  index: number;
  service: string;
  operation: string;
  ok: boolean;
  ms: number;
  attempts: number;
  error?: string;
  captured?: string[];
  checks?: number;
};
// A fixture run as the UI shows it: from the history query (with the target name) or straight from a run.
export type FixtureRunView = {
  id: string;
  status: string;
  trigger?: string;
  results: StepResult[];
  started_at: string;
  finished_at: string | null;
  target_name?: string | null;
};
export type FixtureDetail = { id: string; name: string; description: string; steps: unknown[] };
