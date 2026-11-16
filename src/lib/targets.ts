import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { Conn } from "./aws";
import { decrypt } from "./crypto";
import { isUuid, one } from "./db";
import { type EmulatorVersion, parseEmulatorVersion } from "./emulator-version";
import { readEnv } from "./env";
import { HttpError } from "./http-error";
import { fingerprint } from "./restart";

export type TargetRow = {
  id: string;
  name: string;
  endpoint_url: string;
  region: string;
  tls_servername: string | null;
  ca_pem: string | null;
  auth_mode: "static" | "files";
  access_key_id: string | null;
  secret_key_enc: string | null;
  files_dir: string | null;
  created_at: string;
  last_seen_at: string | null;
  baseline_fixture_id: string | null;
  auto_replay: boolean;
  instance_fingerprint: string | null;
  restarted_at: string | null;
  restart_acknowledged_at: string | null;
};

// Never send ciphertext or key material to the browser.
export const publicTarget = (t: TargetRow) => ({
  id: t.id,
  name: t.name,
  endpointUrl: t.endpoint_url,
  region: t.region,
  tlsServername: t.tls_servername,
  hasCa: !!t.ca_pem,
  authMode: t.auth_mode,
  accessKeyId: t.access_key_id,
  filesDir: t.files_dir,
  createdAt: t.created_at,
  lastSeenAt: t.last_seen_at,
  baselineFixtureId: t.baseline_fixture_id,
  autoReplay: t.auto_replay,
  canDetectRestart: t.auth_mode === "files",
  emulator: emulatorVersion(t),
});

export async function getTarget(targetId: string): Promise<TargetRow> {
  const t = isUuid(targetId) ? await one<TargetRow>("select * from targets where id = $1", [targetId]) : undefined;
  if (!t) throw new HttpError(404, "target not found");
  return t;
}

export const localFilesEnabled = () => readEnv().ALLOW_LOCAL_CREDENTIAL_FILES;
const filesRoot = () => resolve(readEnv().LOCAL_CREDENTIALS_ROOT);

// files mode: read the emulator's own credentials + CA from a directory under LOCAL_CREDENTIALS_ROOT.
// The emulator regenerates its keys on every restart, so these are re-read when the files change.
export function safeFilesDir(dir: string): string {
  if (!localFilesEnabled()) throw new HttpError(400, "local credential files are disabled on this server");
  const root = filesRoot();
  const full = resolve(root, dir.replace(/^\/+/, ""));
  if (full !== root && !full.startsWith(root + sep)) throw new HttpError(400, "directory is outside the allowed root");
  return full;
}

const fileCache = new Map<string, { key: string; value: Pick<Conn, "accessKeyId" | "secretAccessKey" | "ca"> }>();

function readEmulatorFiles(dir: string) {
  const creds = `${dir}/emulator_credentials`;
  const ca = `${dir}/ca.pem`;
  let key: string;
  try {
    key = `${statSync(creds).mtimeMs}:${statSync(ca).mtimeMs}`;
  } catch {
    throw new HttpError(502, `emulator credentials not found in ${dir}: is the emulator running?`);
  }
  const hit = fileCache.get(dir);
  if (hit?.key === key) return hit.value;
  const text = readFileSync(creds, "utf8");
  const accessKeyId = /aws_access_key_id\s*=\s*(\S+)/.exec(text)?.[1];
  const secretAccessKey = /aws_secret_access_key\s*=\s*(\S+)/.exec(text)?.[1];
  if (!accessKeyId || !secretAccessKey) throw new HttpError(502, `could not parse ${creds}`);
  const value = { accessKeyId, secretAccessKey, ca: readFileSync(ca, "utf8") };
  fileCache.set(dir, { key, value });
  return value;
}

export function resolveConn(t: TargetRow): Conn {
  const base = { endpoint: t.endpoint_url, region: t.region, servername: t.tls_servername ?? undefined };
  if (t.auth_mode === "files") return { ...base, ...readEmulatorFiles(safeFilesDir(t.files_dir!)) };
  return {
    ...base,
    accessKeyId: t.access_key_id!,
    secretAccessKey: decrypt(t.secret_key_enc!),
    ca: t.ca_pem ?? undefined,
  };
}

// Identifies the running emulator instance (it regenerates its keys on every start). Only available for targets
// that read the emulator's own credential files; null when unavailable or momentarily unreadable.
export function emulatorFingerprint(t: TargetRow): string | null {
  if (t.auth_mode !== "files" || !localFilesEnabled()) return null;
  try {
    return fingerprint(readEmulatorFiles(safeFilesDir(t.files_dir!)).accessKeyId);
  } catch {
    return null;
  }
}

// Which emulator build is running, as recorded by the emulator image next to its credentials. Null for targets
// without access to those files, and for emulators started from an image that predates the version file.
export function emulatorVersion(t: TargetRow): EmulatorVersion | null {
  if (t.auth_mode !== "files" || !t.files_dir || !localFilesEnabled()) return null;
  try {
    return parseEmulatorVersion(readFileSync(`${safeFilesDir(t.files_dir)}/version`, "utf8"));
  } catch {
    return null;
  }
}
