import assert from "node:assert/strict";

import { test } from "vitest";

import { prune } from "./schema-form";

test("prune drops unset members, empty strings, empty lists/maps and undefined list items", () => {
  assert.deepEqual(prune({ a: "x", b: "", c: undefined, d: [], e: {}, f: [undefined, "y"], g: { h: "", i: 1 } }), {
    a: "x",
    f: ["y"],
    g: { i: 1 },
  });
});

test("false, zero and base64 blobs are real values and survive", () => {
  assert.deepEqual(prune({ flag: false, n: 0, blob: { $base64: "" } }), { flag: false, n: 0, blob: { $base64: "" } });
});
