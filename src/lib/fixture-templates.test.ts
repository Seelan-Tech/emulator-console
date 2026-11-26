import assert from "node:assert/strict";

import { test } from "vitest";

import { operations } from "./aws";
import { checkSteps } from "./fixture-check";
import { assertionSummary } from "./fixture-summary";
import { ASSERTION_TEMPLATES, assertionStep } from "./fixture-templates";
import { operationInput } from "./schema";
import { step } from "./schemas";

const look = {
  operations: (s: string) => operations(s as never),
  input: (s: string, o: string) => operationInput(s as never, o),
};
const sample: Record<string, string> = {
  queueUrl: "http://q",
  count: "2",
  table: "t",
  bucket: "b",
  key: "k",
  fn: "f",
  topicArn: "arn:aws:sns:us-east-1:1:t",
  secret: "s",
};

test("every template builds a step that the schema accepts and Check finds no problem with", async () => {
  for (const t of ASSERTION_TEMPLATES) {
    const r = assertionStep(t.id, sample);
    assert.ok("step" in r, `${t.id}: ${"error" in r ? r.error : ""}`);
    assert.ok(step.safeParse(r.step).success, t.id);
    assert.deepEqual(await checkSteps([r.step], look), [], t.id);
    assert.ok(r.step.expect?.length && r.step.retries > 0, `${t.id} polls`);
  }
});

test("a template adds only what it sets: no defaults such as delayAfterMs", () => {
  for (const t of ASSERTION_TEMPLATES) {
    const r = assertionStep(t.id, sample);
    assert.ok("step" in r);
    assert.deepEqual(
      Object.keys(r.step).sort(),
      ["expect", "input", "operation", "retries", "retryDelayMs", "service"],
      t.id,
    );
  }
});

test("a template uses what was typed, and a count has to be a whole number", () => {
  const ok = assertionStep("queue-messages", { queueUrl: " http://q ", count: "3" });
  assert.ok("step" in ok);
  assert.deepEqual(ok.step.input, { QueueUrl: "http://q", AttributeNames: ["ApproximateNumberOfMessages"] });
  assert.deepEqual(ok.step.expect, [{ path: "Attributes.ApproximateNumberOfMessages", equals: "3" }]);
  assert.deepEqual(assertionStep("queue-messages", { queueUrl: "" }), { error: "Queue URL is required" });
  assert.deepEqual(assertionStep("table-items", { table: "t", count: "-1" }), {
    error: "How many must be a whole number, 0 or more",
  });
  assert.deepEqual(assertionStep("nope", {}), { error: "Choose an assertion" });
  const zero = assertionStep("table-items", { table: "t" }); // the count defaults to 0
  assert.ok("step" in zero);
  assert.deepEqual(zero.step.expect, [{ path: "Count", equals: 0 }]);
});

test("the summary counts the assertions that ran and the ones that held", () => {
  assert.deepEqual(assertionSummary([{ ok: true }, { ok: true, checks: 2 }, { ok: false, checks: 1 }]), {
    total: 2,
    held: 1,
  });
  assert.deepEqual(assertionSummary([{ ok: true }]), { total: 0, held: 0 });
});
