import type { Step } from "./schemas";

export type StepResult = {
  index: number;
  service: string;
  operation: string;
  ok: boolean;
  ms: number;
  attempts: number;
  error?: string;
};
export type RunOutcome = { status: "succeeded" | "failed"; results: StepResult[] };

type Exec = (s: Step) => Promise<{ ok: true; ms: number } | { ok: false; ms: number; error: string }>;

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
  let failed = false;
  for (const [index, s] of steps.entries()) {
    let attempts = 0;
    let last: Awaited<ReturnType<Exec>>;
    do {
      if (attempts > 0) await sleep(s.retryDelayMs);
      attempts++;
      last = await exec(s);
    } while (!last.ok && attempts <= s.retries);
    results.push({
      index,
      service: s.service,
      operation: s.operation,
      ok: last.ok,
      ms: last.ms,
      attempts,
      ...(last.ok ? {} : { error: last.error }),
    });
    if (!last.ok) {
      failed = true;
      if (!opts.continueOnError) break;
    }
    if (s.delayAfterMs) await sleep(s.delayAfterMs);
  }
  return { status: failed ? "failed" : "succeeded", results };
}
