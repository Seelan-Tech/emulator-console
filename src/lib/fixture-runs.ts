import { run as runCommand } from "./aws";
import { reviveBase64 } from "./binary-input";
import { NOW, one } from "./db";
import { execute } from "./execute";
import { resumePlan } from "./fixture-vars";
import { runSteps } from "./fixtures";
import { HttpError } from "./http-error";
import type { FixtureRow } from "./repo";
import { steps as stepsSchema } from "./schemas";
import { resolveConn, type TargetRow } from "./targets";

export type FixtureRunRow = {
  id: string;
  status: string;
  trigger: string;
  results: unknown[];
  started_at: string;
  finished_at: string | null;
};

// Replays a fixture on a target and records the run. Shared by the manual run route, the "replay baseline" button
// and the automatic replay after an emulator restart. Runs synchronously.
export async function runFixtureOnTarget(o: {
  fixture: FixtureRow;
  target: TargetRow;
  trigger: "manual" | "restart";
  continueOnError?: boolean;
  fromStep?: number;
}): Promise<FixtureRunRow> {
  const steps = stepsSchema.parse(o.fixture.steps);
  if (o.fromStep !== undefined && o.fromStep >= steps.length)
    throw new HttpError(400, `the fixture has no step ${o.fromStep + 1}`);
  const plan = o.fromStep === undefined ? steps.map((_, i) => i) : resumePlan(steps, o.fromStep);
  const run = await one<{ id: string }>(
    "insert into fixture_runs(fixture_id, target_id, status, trigger) values ($1,$2,'running',$3) returning id",
    [o.fixture.id, o.target.id, o.trigger],
  );
  const ctx = { target: o.target, source: "fixture" as const };
  try {
    const outcome = await runSteps(
      plan.map((i) => steps[i]!),
      async (s) => {
        const r = await execute(ctx, s.service, s.operation, reviveBase64(s.input), s.region);
        return r.ok ? { ok: true, ms: r.ms, output: r.output } : { ok: false, ms: r.ms, error: r.error.message };
      },
      { continueOnError: o.continueOnError },
    );
    return (await one<FixtureRunRow>(
      `update fixture_runs set status = $2, results = $3, finished_at = ${NOW} where id = $1 returning *`,
      // results are numbered by the step's place in the fixture, also when a resume skipped some
      [run!.id, outcome.status, JSON.stringify(outcome.results.map((r) => ({ ...r, index: plan[r.index]! })))],
    ))!;
  } catch (e) {
    await one(`update fixture_runs set status = 'failed', finished_at = ${NOW} where id = $1`, [run!.id]);
    throw e;
  }
}

// After a restart the emulator needs a moment before it answers: wait for it, with a ceiling.
export async function waitForEmulator(target: TargetRow, timeoutMs = 60_000, intervalMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await runCommand(resolveConn(target), "sts", "GetCallerIdentity", {});
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}
