import assert from "node:assert/strict";

import { test } from "vitest";

import { bannerVisible, fingerprint, observe, shouldAutoReplay } from "./restart";

test("fingerprints are stable, short and never the raw key", () => {
  assert.equal(fingerprint("EMULATORABC"), fingerprint("EMULATORABC"));
  assert.notEqual(fingerprint("EMULATORABC"), fingerprint("EMULATORABD"));
  assert.match(fingerprint("EMULATORABC"), /^[0-9a-f]{16}$/);
  assert.ok(!fingerprint("EMULATORABC").includes("EMULATOR"));
});

test("observations", () => {
  assert.equal(observe(null, null), "unknown");
  assert.equal(observe("a", null), "unknown"); // credentials unreadable mid-restart: do nothing
  assert.equal(observe(null, "a"), "first"); // first sighting is not a restart
  assert.equal(observe("a", "a"), "same");
  assert.equal(observe("a", "b"), "restarted");
});

test("the banner shows until dismissed, and again after a newer restart", () => {
  assert.equal(bannerVisible({ restartedAt: null, acknowledgedAt: null }), false);
  assert.equal(bannerVisible({ restartedAt: "2026-01-01T10:00:00Z", acknowledgedAt: null }), true);
  assert.equal(bannerVisible({ restartedAt: "2026-01-01T10:00:00Z", acknowledgedAt: "2026-01-01T10:05:00Z" }), false);
  assert.equal(bannerVisible({ restartedAt: "2026-01-01T11:00:00Z", acknowledgedAt: "2026-01-01T10:05:00Z" }), true);
});

test("auto replay needs both the switch and a baseline", () => {
  assert.equal(shouldAutoReplay({ autoReplay: true, baselineFixtureId: "x" }), true);
  assert.equal(shouldAutoReplay({ autoReplay: true, baselineFixtureId: null }), false);
  assert.equal(shouldAutoReplay({ autoReplay: false, baselineFixtureId: "x" }), false);
});
