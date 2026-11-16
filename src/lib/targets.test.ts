import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { encrypt } from "./crypto";
import { HttpError } from "./http-error";
import {
  emulatorFingerprint,
  emulatorVersion,
  publicTarget,
  resolveConn,
  safeFilesDir,
  type TargetRow,
} from "./targets";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "creds-"));
  vi.stubEnv("ALLOW_LOCAL_CREDENTIAL_FILES", "true");
  vi.stubEnv("LOCAL_CREDENTIALS_ROOT", root);
  vi.stubEnv("APP_SECRET", "s".repeat(40));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const target = (over: Partial<TargetRow> = {}): TargetRow => ({
  id: "t1",
  name: "n",
  endpoint_url: "https://emulator:9297",
  region: "us-east-1",
  tls_servername: "localhost",
  ca_pem: null,
  auth_mode: "files",
  access_key_id: null,
  secret_key_enc: null,
  files_dir: "9297",
  created_at: "",
  last_seen_at: null,
  baseline_fixture_id: null,
  auto_replay: false,
  instance_fingerprint: null,
  restarted_at: null,
  restart_acknowledged_at: null,
  ...over,
});

function writeCreds(dir: string, key: string, secret = "SECRET", mtime?: number) {
  mkdirSync(join(root, dir), { recursive: true });
  const creds = join(root, dir, "emulator_credentials");
  writeFileSync(creds, `[default]\naws_access_key_id = ${key}\naws_secret_access_key = ${secret}\n`);
  writeFileSync(join(root, dir, "ca.pem"), "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----\n");
  if (mtime) utimesSync(creds, mtime, mtime);
}

test("files mode is refused unless explicitly enabled", () => {
  vi.stubEnv("ALLOW_LOCAL_CREDENTIAL_FILES", "false");
  assert.throws(
    () => safeFilesDir("9297"),
    (e) => e instanceof HttpError && e.status === 400,
  );
});

test("directories resolve under the credentials root and cannot escape it", () => {
  assert.equal(safeFilesDir("9297"), join(root, "9297"));
  assert.equal(safeFilesDir("/9297"), join(root, "9297")); // a leading slash does not mean the filesystem root
  assert.equal(safeFilesDir("a/b"), join(root, "a", "b"));
  for (const bad of ["../etc", "../../etc/passwd", "9297/../../x", "a/../../.."]) {
    assert.throws(() => safeFilesDir(bad), /outside the allowed root/, bad);
  }
});

test("a sibling directory that merely shares the root's prefix is not inside it", () => {
  assert.throws(() => safeFilesDir(`../${root.split("/").pop()}-evil`), /outside the allowed root/);
});

test("files mode reads the emulator's keys and CA", () => {
  writeCreds("9297", "EMULATORKEY1", "SECRET1");
  const c = resolveConn(target());
  assert.equal(c.accessKeyId, "EMULATORKEY1");
  assert.equal(c.secretAccessKey, "SECRET1");
  assert.match(c.ca ?? "", /BEGIN CERTIFICATE/);
  assert.equal(c.endpoint, "https://emulator:9297");
  assert.equal(c.servername, "localhost");
});

test("the emulator regenerates its keys on restart: changed files are re-read", () => {
  writeCreds("9297", "KEY-A", "S", 1_000_000);
  assert.equal(resolveConn(target()).accessKeyId, "KEY-A");
  writeCreds("9297", "KEY-B", "S", 2_000_000);
  assert.equal(resolveConn(target()).accessKeyId, "KEY-B");
});

test("missing or malformed credential files are a clear 502, not a crash", () => {
  assert.throws(
    () => resolveConn(target({ files_dir: "nowhere" })),
    (e) => e instanceof HttpError && e.status === 502 && /is the emulator running/.test(e.message),
  );
  mkdirSync(join(root, "bad"));
  writeFileSync(join(root, "bad", "emulator_credentials"), "garbage");
  writeFileSync(join(root, "bad", "ca.pem"), "x");
  assert.throws(() => resolveConn(target({ files_dir: "bad" })), /could not parse/);
});

test("static mode decrypts the stored secret", () => {
  const t = target({
    auth_mode: "static",
    files_dir: null,
    access_key_id: "AK",
    secret_key_enc: encrypt("my-secret"),
    ca_pem: "PEM",
  });
  const c = resolveConn(t);
  assert.deepEqual([c.accessKeyId, c.secretAccessKey, c.ca], ["AK", "my-secret", "PEM"]);
});

test("the instance fingerprint follows the keys, and is unavailable for static targets", () => {
  writeCreds("9297", "KEY-1", "S", 3_000_000);
  const a = emulatorFingerprint(target());
  assert.match(a ?? "", /^[0-9a-f]{16}$/);
  assert.equal(emulatorFingerprint(target()), a);
  writeCreds("9297", "KEY-2", "S", 4_000_000);
  assert.notEqual(emulatorFingerprint(target()), a);
  assert.equal(emulatorFingerprint(target({ auth_mode: "static" })), null);
  assert.equal(emulatorFingerprint(target({ files_dir: "nowhere" })), null); // unreadable mid-restart
  vi.stubEnv("ALLOW_LOCAL_CREDENTIAL_FILES", "false");
  assert.equal(emulatorFingerprint(target()), null);
});

test("publicTarget never exposes secrets or the CA text", () => {
  const view = publicTarget(
    target({ auth_mode: "static", access_key_id: "AK", secret_key_enc: "v1:cipher", ca_pem: "PEM" }),
  );
  const text = JSON.stringify(view);
  assert.ok(!text.includes("cipher") && !text.includes("PEM"));
  assert.equal(view.hasCa, true);
  assert.equal(view.canDetectRestart, false);
  assert.equal(publicTarget(target()).canDetectRestart, true);
});

test("the emulator's version comes from the file its image writes beside the credentials", () => {
  writeCreds("9297", "KEY-1", "S");
  assert.equal(emulatorVersion(target()), null); // an image that predates the version file
  writeFileSync(join(root, "9297", "version"), "Version: 1.0.385\nRelease date: 2026.11.14\nCommit: abcdef1\n");
  assert.deepEqual(emulatorVersion(target()), { version: "1.0.385", releaseDate: "2026-11-14", commit: "abcdef1" });
  assert.equal(publicTarget(target()).emulator?.version, "1.0.385");
  writeFileSync(join(root, "9297", "version"), "garbage");
  assert.equal(emulatorVersion(target()), null);
  assert.equal(emulatorVersion(target({ auth_mode: "static" })), null);
});
