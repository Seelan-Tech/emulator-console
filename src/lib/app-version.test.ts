import assert from "node:assert/strict";

import { test } from "vitest";

import { aboutDetails, changelogUrl, releaseNotesUrl, versionLabel } from "./app-version";

const release = { version: "0.2.0", revision: "af784f2359016ba0a0442829ffca629a5c3c6355", release: true };
const branch = { version: "0.2.0", revision: "57f3b15abcdef", release: false };

test("a release shows its version; any other build shows the commit it is made from", () => {
  assert.equal(versionLabel(release), "v0.2.0");
  assert.equal(versionLabel(branch), "0.2.0+57f3b15");
  assert.equal(versionLabel({ version: "0.2.0", release: false }), "0.2.0 (dev)");
  assert.equal(versionLabel({ release: false }), "dev");
});

test("links go to the release tag only for a release build", () => {
  assert.match(releaseNotesUrl(release), /\/releases\/tag\/v0\.2\.0$/);
  assert.match(releaseNotesUrl(branch), /\/releases$/);
  assert.match(changelogUrl(release), /\/blob\/v0\.2\.0\/CHANGELOG\.md$/);
  assert.match(changelogUrl(branch), /\/blob\/main\/CHANGELOG\.md$/);
});

test("the details block names the console, revision, emulators and browser", () => {
  assert.equal(
    aboutDetails({
      build: release,
      emulators: [{ name: "Local emulator", version: "1.0.471" }],
      browser: "Mozilla/5.0",
    }),
    [
      "Emulator Console v0.2.0 (release)",
      "Revision: af784f2359016ba0a0442829ffca629a5c3c6355",
      "Emulator (Local emulator): 1.0.471",
      "Browser: Mozilla/5.0",
    ].join("\n"),
  );
  assert.equal(aboutDetails({ build: { release: false }, emulators: [] }), "Emulator Console dev");
});
