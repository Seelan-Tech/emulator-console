import assert from "node:assert/strict";

import { test } from "vitest";

import { tryParseJson } from "./json";

test("valid JSON parses and anything else is undefined (never throws)", () => {
  assert.deepEqual(tryParseJson('{"a":[1,2]}'), { a: [1, 2] });
  assert.equal(tryParseJson("42"), 42);
  assert.equal(tryParseJson("null"), null);
  assert.equal(tryParseJson("not json"), undefined);
  assert.equal(tryParseJson(""), undefined);
  assert.equal(tryParseJson("{broken"), undefined);
});
