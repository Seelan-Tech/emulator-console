import assert from "node:assert/strict";

import { test } from "vitest";

import { mask, prettySecret, secretHref, validateSecretName } from "./logic";

test("names with slashes travel safely in the URL", () => {
  assert.equal(secretHref("/t/2", "app/db password"), "/t/2/secrets/detail?name=app%2Fdb%20password");
});

test("secret name rules", () => {
  assert.equal(validateSecretName("app/prod/db-password_1"), null);
  for (const bad of ["", "has space", "emoji😀", "x".repeat(513)]) assert.notEqual(validateSecretName(bad), null, bad);
});

test("JSON secrets are pretty-printed, plain ones untouched", () => {
  assert.deepEqual(prettySecret('{"u":"a"}'), { text: '{\n  "u": "a"\n}', json: true });
  assert.deepEqual(prettySecret("hunter2"), { text: "hunter2", json: false });
});

test("mask hides the real length within bounds", () => {
  assert.equal(mask("abc").length, 8);
  assert.equal(mask("x".repeat(100)).length, 24);
});
