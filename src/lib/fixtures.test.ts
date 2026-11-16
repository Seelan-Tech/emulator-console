import assert from "node:assert/strict";

import { test } from "vitest";

import { runSteps } from "./fixtures";
import { type Step, step } from "./schemas";

const mk = (operation: string, extra: Partial<Step> = {}): Step => step.parse({ service: "s3", operation, ...extra });
const noSleep = async () => {};

test("runs steps in order and succeeds", async () => {
  const seen: string[] = [];
  const out = await runSteps(
    [mk("CreateBucket"), mk("PutObject")],
    async (s) => (seen.push(s.operation), { ok: true, ms: 1 }),
    { sleep: noSleep },
  );
  assert.equal(out.status, "succeeded");
  assert.deepEqual(seen, ["CreateBucket", "PutObject"]);
});

test("stops at the first failure by default", async () => {
  const out = await runSteps(
    [mk("A"), mk("B"), mk("C")],
    async (s) => (s.operation === "B" ? { ok: false, ms: 1, error: "boom" } : { ok: true, ms: 1 }),
    { sleep: noSleep },
  );
  assert.equal(out.status, "failed");
  assert.deepEqual(
    out.results.map((r) => r.operation),
    ["A", "B"],
  );
  assert.equal(out.results[1]!.error, "boom");
});

test("continueOnError runs the remaining steps but still reports failure", async () => {
  const out = await runSteps(
    [mk("A"), mk("B"), mk("C")],
    async (s) => (s.operation === "A" ? { ok: false, ms: 1, error: "x" } : { ok: true, ms: 1 }),
    { continueOnError: true, sleep: noSleep },
  );
  assert.equal(out.status, "failed");
  assert.equal(out.results.length, 3);
});

test("retries a flaky step, waiting between attempts", async () => {
  let calls = 0;
  const waits: number[] = [];
  const out = await runSteps(
    [mk("PutItem", { retries: 3, retryDelayMs: 250 })],
    async () => (++calls < 3 ? { ok: false, ms: 1, error: "table is CREATING" } : { ok: true, ms: 1 }),
    { sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(out.status, "succeeded");
  assert.equal(out.results[0]!.attempts, 3);
  assert.deepEqual(waits, [250, 250]);
});

test("gives up after retries are exhausted", async () => {
  let calls = 0;
  const out = await runSteps([mk("X", { retries: 2 })], async () => (calls++, { ok: false, ms: 1, error: "no" }), {
    sleep: noSleep,
  });
  assert.equal(calls, 3);
  assert.equal(out.status, "failed");
});

test("delayAfterMs pauses after a successful step", async () => {
  const waits: number[] = [];
  await runSteps([mk("A", { delayAfterMs: 500 }), mk("B")], async () => ({ ok: true, ms: 1 }), {
    sleep: async (ms) => void waits.push(ms),
  });
  assert.deepEqual(waits, [500]);
});

test("step schema rejects unknown services and bad operation names", () => {
  assert.throws(() => step.parse({ service: "nope", operation: "X" }));
  assert.throws(() => step.parse({ service: "s3", operation: "../x" }));
});
