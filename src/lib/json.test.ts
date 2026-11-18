import assert from "node:assert/strict";

import { test } from "vitest";

import { beautifyJson, tryParseJson } from "./json";

test("valid JSON parses and anything else is undefined (never throws)", () => {
  assert.deepEqual(tryParseJson('{"a":[1,2]}'), { a: [1, 2] });
  assert.equal(tryParseJson("42"), 42);
  assert.equal(tryParseJson("null"), null);
  assert.equal(tryParseJson("not json"), undefined);
  assert.equal(tryParseJson(""), undefined);
  assert.equal(tryParseJson("{broken"), undefined);
});

test("beautifyJson indents objects and arrays and leaves everything else alone", () => {
  assert.equal(beautifyJson('{"a":[1,{"b":2}]}'), '{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ]\n}');
  assert.equal(beautifyJson("  [1,2] "), "[\n  1,\n  2\n]");
  assert.equal(beautifyJson("42"), undefined);
  assert.equal(beautifyJson('"text"'), undefined);
  assert.equal(beautifyJson("null"), undefined);
  assert.equal(beautifyJson("{broken"), undefined);
  assert.equal(beautifyJson(""), undefined);
});
