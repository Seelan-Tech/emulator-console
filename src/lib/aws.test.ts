import assert from "node:assert/strict";

import { test } from "vitest";

import { operations, serviceNames } from "./aws";

test("operation lists contain real operations only", async () => {
  for (const svc of serviceNames) {
    const ops = await operations(svc);
    assert.ok(ops.length > 0, svc);
    assert.ok(
      ops.every((o) => /^[A-Z][A-Za-z0-9]+$/.test(o)),
      `${svc}: ${ops.filter((o) => !/^[A-Z][A-Za-z0-9]+$/.test(o)).join(", ")}`,
    );
  }
  assert.ok((await operations("s3")).includes("PutObject"));
  assert.ok(!(await operations("s3")).includes("$"));
});
