// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { sessionStorageJson, storage } from "./storage";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

test("round-trips strings and JSON", () => {
  storage.set("k", "v");
  assert.equal(storage.get("k"), "v");
  assert.equal(storage.get("missing"), null);
  storage.setJson("j", { a: [1, 2] });
  assert.deepEqual(storage.getJson("j", null), { a: [1, 2] });
});

test("getJson falls back on a missing key or corrupt JSON", () => {
  assert.deepEqual(storage.getJson("none", [1]), [1]);
  localStorage.setItem("bad", "{not json");
  assert.deepEqual(storage.getJson("bad", { ok: true }), { ok: true });
});

test("never throws when storage is unavailable or full", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  assert.equal(storage.get("k"), null);
  assert.deepEqual(storage.getJson("k", "fallback"), "fallback");
  assert.doesNotThrow(() => storage.set("k", "v"));
  assert.doesNotThrow(() => storage.setJson("k", {}));
  assert.deepEqual(sessionStorageJson.get("k", 5), 5);
  assert.doesNotThrow(() => sessionStorageJson.set("k", 1));
});

test("session storage helper round-trips", () => {
  sessionStorageJson.set("s", { n: 1 });
  assert.deepEqual(sessionStorageJson.get("s", null), { n: 1 });
  assert.equal(sessionStorageJson.get("absent", "d"), "d");
});
