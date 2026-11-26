import { evaluateExpect } from "./fixture-expect";
import { getPath, substitute, type Vars } from "./fixture-vars";
import type { Expectation, Step } from "./schemas";

export type StepResult = {
  index: number;
  service: string;
  operation: string;
  ok: boolean;
  ms: number;
  attempts: number;
  error?: string;
  captured?: string[]; // names only: the values are not kept
  checks?: number; // how many `expect` checks the step has; a failed one is the step's `error`
};
export type RunOutcome = { status: "succeeded" | "failed"; results: StepResult[] };

// Gets the step with its variables filled in. A successful call returns its output, for `capture`.
type Exec = (s: Step) => Promise<{ ok: true; ms: number; output?: unknown } | { ok: false; ms: number; error: string }>;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Replays steps in order. A step may retry (e.g. a DynamoDB table that is still CREATING) and pause afterwards.
// Execution and sleeping are injected so the engine is unit-testable without an emulator.
export async function runSteps(
  steps: Step[],
  exec: Exec,
  opts: { continueOnError?: boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunOutcome> {
  const sleep = opts.sleep ?? realSleep;
  const results: StepResult[] = [];
  const vars: Vars = {};
  let failed = false;
  for (const [index, s] of steps.entries()) {
    let attempts = 0;
    const captured: string[] = [];
    let last: Awaited<ReturnType<Exec>>;
    const { value: filled, missing } = substitute({ input: s.input, expect: s.expect ?? [] }, vars);
    const { input, expect } = filled as { input: Step["input"]; expect: Expectation[] };
    if (missing.length) {
      // Nothing is sent: the step needs a value no earlier step has captured.
      last = {
        ok: false,
        ms: 0,
        error: `Variable ${missing.map((m) => `"${m}"`).join(", ")} is not set by an earlier step`,
      };
    } else {
      const resolved = { ...s, input };
      do {
        if (attempts > 0) await sleep(s.retryDelayMs);
        attempts++;
        last = await exec(resolved);
        // A read can be repeated, so a check that does not hold yet is retried like a failed call.
        if (last.ok && expect.length) {
          const failures = evaluateExpect(expect, last.output, s.service);
          if (failures.length) last = { ok: false, ms: last.ms, error: failures.join("; ") };
        }
      } while (!last.ok && attempts <= s.retries);
      if (last.ok) {
        // The call went through, so a missing value is not retried: the state has already changed.
        for (const [name, path] of Object.entries(s.capture ?? {})) {
          const v = getPath(last.output, path);
          if (v === undefined || v === null) {
            last = { ok: false, ms: last.ms, error: `The response has no "${path}" to keep as "${name}"` };
            break;
          }
          vars[name] = v;
          captured.push(name);
        }
      }
    }
    results.push({
      index,
      service: s.service,
      operation: s.operation,
      ok: last.ok,
      ms: last.ms,
      attempts,
      ...(last.ok ? {} : { error: last.error }),
      ...(captured.length ? { captured } : {}),
      ...(s.expect?.length ? { checks: s.expect.length } : {}),
    });
    if (!last.ok) {
      failed = true;
      if (!opts.continueOnError) break;
    }
    if (s.delayAfterMs) await sleep(s.delayAfterMs);
  }
  return { status: failed ? "failed" : "succeeded", results };
}
