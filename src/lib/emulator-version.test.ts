import assert from "node:assert/strict";

import { test } from "vitest";

import { parseEmulatorVersion } from "./emulator-version";

test("reads version, release date and commit from the emulator's --version output", () => {
  const out = "Version: 1.0.385\nRelease date: 2026.11.14\nCommit: 813af480bf7f16d5418b64e4f5644a74a7da11c5\n";
  assert.deepEqual(parseEmulatorVersion(out), {
    version: "1.0.385",
    releaseDate: "2026-11-14",
    commit: "813af480bf7f16d5418b64e4f5644a74a7da11c5",
  });
});

test("only the version is required", () => {
  assert.deepEqual(parseEmulatorVersion("Version: 2.1.0"), { version: "2.1.0", releaseDate: null, commit: null });
});

test("anything else is not a version", () => {
  assert.equal(parseEmulatorVersion(""), null);
  assert.equal(parseEmulatorVersion("ok"), null);
});
