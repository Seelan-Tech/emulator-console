import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { log } from "./log";

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((s: string) => void out.push(`log:${s}`));
  vi.spyOn(console, "warn").mockImplementation((s: string) => void out.push(`warn:${s}`));
  vi.spyOn(console, "error").mockImplementation((s: string) => void out.push(`error:${s}`));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("development output is readable text with the metadata appended", () => {
  vi.stubEnv("NODE_ENV", "development");
  log.info("hello", { a: 1 });
  assert.deepEqual(out, ['log:INFO hello {"a":1}']);
});

test("production output is one JSON object per line", () => {
  vi.stubEnv("NODE_ENV", "production");
  log.error("bad thing", { code: 7 });
  assert.equal(out.length, 1);
  const line = out[0]!;
  assert.ok(line.startsWith("error:"));
  const rec = JSON.parse(line.slice("error:".length)) as Record<string, unknown>;
  assert.equal(rec.level, "error");
  assert.equal(rec.msg, "bad thing");
  assert.equal(rec.code, 7);
  assert.ok(typeof rec.time === "string" && !Number.isNaN(Date.parse(rec.time)));
});

test("levels route to the matching console method", () => {
  vi.stubEnv("LOG_LEVEL", "debug");
  vi.stubEnv("NODE_ENV", "development");
  log.debug("d");
  log.warn("w");
  log.error("e");
  assert.deepEqual(
    out.map((l) => l.split(" ")[0]),
    ["log:DEBUG", "warn:WARN", "error:ERROR"],
  );
});

test("LOG_LEVEL filters out quieter messages", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LOG_LEVEL", "warn");
  log.debug("no");
  log.info("no");
  log.warn("yes");
  assert.equal(out.length, 1);
  vi.stubEnv("LOG_LEVEL", "nonsense"); // unknown values fall back to info
  log.info("shown");
  assert.equal(out.length, 2);
});
