import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { readEnv } from "./env";

// The console keeps everything in one SQLite file (DATA_DIR/emulator-console.db), opened on first use and migrated
// from db/migrations. The driver is synchronous; the helpers below stay async so call sites read like any DB client.

// SQLite has no boolean or JSON types, so a few columns are converted on the way out.
const BOOLEAN_COLUMNS = new Set(["mutating", "ok", "auto_replay"]);
const JSON_COLUMNS = new Set(["steps", "results"]);

// Current time as the ISO 8601 UTC string every timestamp column holds. Interpolate it into SQL: `set x = ${NOW}`.
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const g = globalThis as unknown as { __db?: DatabaseSync };

function migrate(db: DatabaseSync) {
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir)
    .map((name) => ({ name, n: Number(/^(\d+)_.*\.sql$/.exec(name)?.[1]) }))
    .filter((f) => Number.isInteger(f.n))
    .sort((a, b) => a.n - b.n);
  const current = Number((db.prepare("pragma user_version").get() as { user_version: number }).user_version);
  for (const f of files.filter((f) => f.n > current)) {
    db.exec("begin");
    try {
      db.exec(readFileSync(join(dir, f.name), "utf8"));
      db.exec(`pragma user_version = ${f.n}`);
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      throw e;
    }
  }
}

function handle(): DatabaseSync {
  if (g.__db) return g.__db;
  const dataDir = readEnv().DATA_DIR;
  let file = ":memory:";
  if (dataDir !== ":memory:") {
    mkdirSync(resolve(dataDir), { recursive: true });
    file = join(resolve(dataDir), "emulator-console.db");
  }
  const db = new DatabaseSync(file);
  db.exec(
    "pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000; pragma synchronous = normal",
  );
  migrate(db);
  return (g.__db = db);
}

const toParam = (v: unknown): SQLInputValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v as SQLInputValue;
};

function revive<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      JSON_COLUMNS.has(k) && typeof v === "string"
        ? (JSON.parse(v) as unknown)
        : BOOLEAN_COLUMNS.has(k) && typeof v === "number"
          ? v !== 0
          : v;
  }
  return out as T;
}

// Statements use $1, $2, … placeholders. Booleans and objects are bound as 0/1 and JSON text.
export function query<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  try {
    const rows = handle()
      .prepare(text.replace(/\$(\d+)/g, "?$1"))
      .all(...params.map(toParam));
    return Promise.resolve(rows.map((r) => revive<T>(r)));
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function one<T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

// The row an `insert … returning` produced; its absence would be a bug, not a normal outcome.
export function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected a row but the query returned none");
  return row;
}

// For tests: close the connection so the next query reopens (and re-reads DATA_DIR).
export function closeDb() {
  g.__db?.close();
  g.__db = undefined;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
