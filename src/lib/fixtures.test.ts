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

test("a step keeps values from its response and later steps use them", async () => {
  const seen: unknown[] = [];
  const out = await runSteps(
    [
      mk("CreateKey", { capture: { keyId: "KeyMetadata.KeyId", first: "Keys[0].Id" } }),
      mk("CreateAlias", { input: { TargetKeyId: "{{keyId}}", Note: "key {{keyId}} / {{first}}" } }),
    ],
    async (s) => {
      seen.push(s.input);
      return { ok: true, ms: 1, output: { KeyMetadata: { KeyId: "k-123" }, Keys: [{ Id: 7 }] } };
    },
    { sleep: noSleep },
  );
  assert.equal(out.status, "succeeded");
  assert.deepEqual(seen[1], { TargetKeyId: "k-123", Note: "key k-123 / 7" });
  assert.deepEqual(out.results[0]!.captured, ["keyId", "first"]);
  assert.equal(out.results[1]!.captured, undefined);
});

test("a step that uses a variable nothing has set fails without calling the emulator", async () => {
  let calls = 0;
  const out = await runSteps(
    [mk("CreateAlias", { input: { TargetKeyId: "{{keyId}}" }, retries: 3 })],
    async () => (calls++, { ok: true, ms: 1 }),
    { sleep: noSleep },
  );
  assert.equal(out.status, "failed");
  assert.equal(calls, 0);
  assert.equal(out.results[0]!.attempts, 0);
  assert.match(out.results[0]!.error!, /Variable "keyId" is not set/);
});

test("a path that matches nothing fails the step, and the call is not repeated", async () => {
  let calls = 0;
  const out = await runSteps(
    [mk("CreateKey", { capture: { keyId: "KeyMetadata.KeyId" }, retries: 3 })],
    async () => (calls++, { ok: true, ms: 1, output: {} }),
    { sleep: noSleep },
  );
  assert.equal(out.status, "failed");
  assert.equal(calls, 1);
  assert.match(out.results[0]!.error!, /no "KeyMetadata.KeyId" to keep as "keyId"/);
});

test("a variable needed after a failed step stops a continue-on-error run only for the steps that use it", async () => {
  const out = await runSteps(
    [mk("A", { capture: { x: "X" } }), mk("B", { input: { v: "{{x}}" } }), mk("C")],
    async (s) => (s.operation === "A" ? { ok: false, ms: 1, error: "boom" } : { ok: true, ms: 1 }),
    { sleep: noSleep, continueOnError: true },
  );
  assert.deepEqual(
    out.results.map((r) => r.ok),
    [false, false, true],
  );
});
