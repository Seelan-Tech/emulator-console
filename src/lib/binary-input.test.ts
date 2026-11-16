import assert from "node:assert/strict";

import { test } from "vitest";

import { reviveBase64 } from "./binary-input";

test("{$base64} becomes a Buffer, at any depth, and other values are untouched", () => {
  const out: any = reviveBase64({
    FunctionName: "f",
    Code: { ZipFile: { $base64: Buffer.from("zip!").toString("base64") } },
    list: [{ $base64: "YQ==" }, 1, "x"],
    n: null,
  });
  assert.ok(Buffer.isBuffer(out.Code.ZipFile));
  assert.equal(out.Code.ZipFile.toString(), "zip!");
  assert.equal(out.list[0].toString(), "a");
  assert.deepEqual([out.FunctionName, out.list[1], out.list[2], out.n], ["f", 1, "x", null]);
});

test("objects that merely contain a $base64 key among others are left alone", () => {
  assert.deepEqual(reviveBase64({ $base64: "YQ==", other: 1 }), { $base64: "YQ==", other: 1 });
});
