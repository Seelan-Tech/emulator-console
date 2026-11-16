import assert from "node:assert/strict";

import { test } from "vitest";

import { cn, formatBytes, timeAgo } from "./utils";

test("cn merges class names and lets later Tailwind classes win", () => {
  assert.equal(cn("p-2", (false as boolean) && "hidden", "text-sm"), "p-2 text-sm");
  assert.equal(cn("p-2", "p-4"), "p-4");
});

test("formatBytes picks a sensible unit", () => {
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(undefined), "");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(3 * 1024 ** 3), "3.0 GB");
});

test("timeAgo is relative to the given clock", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(timeAgo(undefined, now), "");
  assert.equal(timeAgo(ago(2), now), "just now");
  assert.equal(timeAgo(ago(30), now), "30s ago");
  assert.equal(timeAgo(ago(5 * 60), now), "5m ago");
  assert.equal(timeAgo(ago(3 * 3600), now), "3h ago");
  assert.equal(timeAgo(ago(2 * 86400), now), "2d ago");
});
