import assert from "node:assert/strict";

import { test } from "vitest";

import { decodeLog, handlerFile, isReady } from "./runtimes";

test("handler maps to the file the zip must contain", () => {
  assert.equal(handlerFile("python3.12", "index.handler"), "index.py");
  assert.equal(handlerFile("nodejs20.x", "app.main"), "app.mjs");
});

test("a function is ready once it is neither pending nor updating", () => {
  assert.equal(isReady({ State: "Active", LastUpdateStatus: "Successful" }), true);
  assert.equal(isReady({ State: "Pending" }), false);
  assert.equal(isReady({ State: "Active", LastUpdateStatus: "InProgress" }), false);
  assert.equal(isReady(undefined), false);
});

test("logs decode from base64 including non-ASCII", () => {
  assert.equal(decodeLog(Buffer.from("héllo\nworld").toString("base64")), "héllo\nworld");
  assert.equal(decodeLog(undefined), "");
});
