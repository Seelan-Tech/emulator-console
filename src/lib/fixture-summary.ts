import type { StepResult } from "./api-types";

// How many of a run's assertions held. Only steps that ran are counted: a run that stopped has no result for the rest.
export function assertionSummary(results: Pick<StepResult, "ok" | "checks">[]): { total: number; held: number } {
  const asserted = results.filter((r) => r.checks);
  return { total: asserted.length, held: asserted.filter((r) => r.ok).length };
}
