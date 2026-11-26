import assert from "node:assert/strict";

import { test } from "vitest";

import { getPath, referencedVars, substitute, VAR_PATH } from "./fixture-vars";
import { step } from "./schemas";

test("getPath follows names and list positions", () => {
  const v = { A: { B: [{ C: "x" }, { C: "y" }] }, Z: 0 };
  assert.equal(getPath(v, "A.B[1].C"), "y");
  assert.equal(getPath(v, "Z"), 0);
  assert.equal(getPath(v, "A.B[5].C"), undefined);
  assert.equal(getPath(v, "A.Q.C"), undefined);
  assert.equal(getPath("text", "A"), undefined);
});

test("substitute keeps the type of a whole-string placeholder and writes the others as text", () => {
  const { value, missing } = substitute(
    { a: "{{n}}", b: "n={{n}}!", c: ["{{ s }}", { d: "{{s}}-{{s}}" }], e: 5 },
    { n: 3, s: "id" },
  );
  assert.deepEqual(value, { a: 3, b: "n=3!", c: ["id", { d: "id-id" }], e: 5 });
  assert.deepEqual(missing, []);
  assert.deepEqual(substitute({ o: "v: {{o}}" }, { o: { k: 1 } }).value, { o: 'v: {"k":1}' });
});

test("substitute lists names that are not set and leaves their placeholders", () => {
  const { value, missing } = substitute({ a: "{{x}}", b: "p-{{y}}-{{x}}" }, {});
  assert.deepEqual(value, { a: "{{x}}", b: "p-{{y}}-{{x}}" });
  assert.deepEqual(missing, ["x", "y"]);
  // a value that is falsy is still set
  assert.deepEqual(substitute("{{z}}", { z: 0 }), { value: 0, missing: [] });
});

test("referencedVars lists each name once, in order", () => {
  assert.deepEqual(referencedVars({ a: "{{b}} {{a}}", c: ["{{b}}"], d: 1 }), ["b", "a"]);
});

test("a step accepts capture entries with valid names and paths only", () => {
  const ok = step.safeParse({ service: "kms", operation: "CreateKey", capture: { keyId: "KeyMetadata.KeyId" } });
  assert.equal(ok.success, true);
  assert.equal(step.safeParse({ service: "kms", operation: "CreateKey" }).data?.capture, undefined);
  assert.equal(step.safeParse({ service: "kms", operation: "X", capture: { "bad name": "A" } }).success, false);
  assert.equal(step.safeParse({ service: "kms", operation: "X", capture: { a: "A..B" } }).success, false);
  assert.ok(VAR_PATH.test("Subnets[0].SubnetId"));
});
