import assert from "node:assert/strict";

import { test } from "vitest";

import { errorInfo, errorMessage, isUniqueViolation } from "./errors";

test("errorMessage handles errors, strings and anything else", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage({ weird: true }), "unknown error");
  assert.equal(errorMessage(undefined), "unknown error");
});

test("errorInfo reads the HTTP status from an AWS SDK error", () => {
  const e = Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
  assert.deepEqual(errorInfo(e), { name: "AccessDenied", message: "denied", status: 403 });
});

test("errorInfo falls back to a plain status, and to the message for non-errors", () => {
  assert.deepEqual(errorInfo(Object.assign(new Error("x"), { status: 404 })), {
    name: "Error",
    message: "x",
    status: 404,
  });
  assert.deepEqual(errorInfo("just text"), { message: "just text" });
});

test("isUniqueViolation recognises SQLite unique-constraint errors only", () => {
  assert.equal(isUniqueViolation(new Error("UNIQUE constraint failed: targets.name")), true);
  assert.equal(isUniqueViolation(new Error("FOREIGN KEY constraint failed")), false);
  assert.equal(isUniqueViolation(new Error("x")), false);
  assert.equal(isUniqueViolation({ message: "UNIQUE constraint failed: t.c" }), false);
  assert.equal(isUniqueViolation(null), false);
});
