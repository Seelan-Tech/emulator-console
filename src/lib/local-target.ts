import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { one } from "./db";
import { readEnv } from "./env";

// When the emulator's credential files are mounted, make sure a ready-to-use "Local emulator" target exists.
// Idempotent and cheap; called when the Targets page loads and by the restart watcher.
export async function ensureLocalTarget(): Promise<void> {
  const env = readEnv();
  if (!env.ALLOW_LOCAL_CREDENTIAL_FILES) return;
  const root = resolve(env.LOCAL_CREDENTIALS_ROOT);
  let dir: string | undefined;
  try {
    dir = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`${root}/${d.name}/emulator_credentials`))
      .map((d) => d.name)
      .sort()[0];
  } catch {
    return; // credentials root not mounted
  }
  if (!dir) return;
  const endpoint = env.LOCAL_TARGET_ENDPOINT ?? (/^\d+$/.test(dir) ? `https://emulator:${dir}` : undefined);
  if (!endpoint) return;
  await one(
    `insert into targets(name, endpoint_url, region, tls_servername, auth_mode, files_dir)
     values ('Local emulator', $1, 'us-east-1', 'localhost', 'files', $2) on conflict (name) do nothing`,
    [endpoint, dir],
  );
}
