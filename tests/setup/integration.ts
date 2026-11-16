import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach } from "vitest";

// Environment first: lib/env.ts reads it lazily, and lib/db.ts opens (and migrates) the database on first use.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ec-data-"));
process.env.APP_SECRET = "integration-test-secret-integration-test-secret";
export const credsRoot = mkdtempSync(join(tmpdir(), "ec-creds-"));
process.env.ALLOW_LOCAL_CREDENTIAL_FILES = "true";
process.env.LOCAL_CREDENTIALS_ROOT = credsRoot;
process.env.LOG_LEVEL = "error";

beforeEach(async () => {
  const { query } = await import("@/lib/db");
  for (const table of ["audit_log", "fixture_runs", "fixtures", "targets"]) await query(`delete from ${table}`);
  await query("delete from sqlite_sequence"); // restart audit ids, like a fresh database
});
