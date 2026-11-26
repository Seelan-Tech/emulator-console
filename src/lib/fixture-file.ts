// The file a fixture is shared as, and how an import is planned. Pure: the routes and the browser share it.
//
//   { "format": "emulator-console-fixture",  "version": 1, "name", "description", "steps": [...] }
//   { "format": "emulator-console-fixtures", "version": 1, "fixtures": [{ "name", "description", "steps" }, ...] }

export const FILE_FORMAT = "emulator-console-fixture";
export const BUNDLE_FORMAT = "emulator-console-fixtures";
export const FILE_VERSION = 1;
export const MAX_FILE_BYTES = 5_000_000;

export type FixtureData = { name: string; description: string; steps: unknown[] };

export class FileError extends Error {}

// Two-space indent and a trailing newline, so a file in git diffs cleanly.
const text = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const data = (f: FixtureData) => ({ name: f.name, description: f.description, steps: f.steps });

export const fixtureFile = (f: FixtureData) => text({ format: FILE_FORMAT, version: FILE_VERSION, ...data(f) });

export const bundleFile = (list: FixtureData[]) =>
  text({
    format: BUNDLE_FORMAT,
    version: FILE_VERSION,
    fixtures: [...list].sort((a, b) => a.name.localeCompare(b.name)).map(data),
  });

// The fixtures in a file (one or a bundle), as written: each is validated later, so one bad fixture does not hide the rest.
export function parseFixtureFile(raw: string): unknown[] {
  if (raw.length > MAX_FILE_BYTES) throw new FileError(`The file is larger than ${MAX_FILE_BYTES / 1_000_000} MB`);
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new FileError("This is not a JSON file");
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new FileError("This is not a fixture file");
  const o = v as Record<string, unknown>;
  if (o.format !== FILE_FORMAT && o.format !== BUNDLE_FORMAT)
    throw new FileError(`This is not a fixture file (expected "format": "${FILE_FORMAT}")`);
  if (typeof o.version !== "number" || !Number.isInteger(o.version) || o.version < 1)
    throw new FileError("The file has no valid version");
  if (o.version > FILE_VERSION)
    throw new FileError(
      `The file is version ${o.version}; this console reads up to version ${FILE_VERSION}. Update it.`,
    );
  if (o.format === BUNDLE_FORMAT) {
    if (!Array.isArray(o.fixtures)) throw new FileError('The file has no "fixtures" list');
    return o.fixtures as unknown[];
  }
  return [{ name: o.name, description: o.description, steps: o.steps }];
}

// A file name for a fixture: letters, digits and dashes.
export const fileSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "fixture";

// Steps that carry values that may be secret. A fixture file is plain text: whoever has it can read them.
export type SecretStep = { step: number; call: string; what: string };
export function secretSteps(steps: unknown[]): SecretStep[] {
  const out: SecretStep[] = [];
  steps.forEach((raw, i) => {
    const s = (raw ?? {}) as { service?: unknown; operation?: unknown; input?: Record<string, unknown> };
    const input = s.input && typeof s.input === "object" ? s.input : {};
    const call = `${String(s.service)}.${String(s.operation)}`;
    const add = (what: string) => out.push({ step: i + 1, call, what });
    switch (call) {
      case "secretsmanager.CreateSecret":
      case "secretsmanager.PutSecretValue":
      case "secretsmanager.UpdateSecret":
        if (input.SecretString !== undefined || input.SecretBinary !== undefined) add("a secret value");
        break;
      case "ssm.PutParameter":
        if (input.Type === "SecureString") add("a secure parameter value");
        break;
      case "lambda.CreateFunction":
      case "lambda.UpdateFunctionConfiguration": {
        const env = input.Environment as { Variables?: unknown } | undefined;
        const vars = env?.Variables;
        if (vars && typeof vars === "object" && Object.keys(vars).length) add("environment variables");
        break;
      }
      case "iam.CreateLoginProfile":
        if (input.Password !== undefined) add("a password");
        break;
    }
  });
  return out;
}

export type OnConflict = "rename" | "replace" | "skip";
export type PlannedItem = { name: string; action: "create" | "rename" | "replace" | "skip" };

// A name that is free: "orders (2)", "orders (3)", cut so that it still fits the 100 characters a name may have.
export function freeName(name: string, taken: Set<string>): string {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// What an import does with each name, given the names that exist. A name that exists is renamed, replaced or skipped.
export function planImport(names: string[], existing: Set<string>, onConflict: OnConflict): PlannedItem[] {
  const taken = new Set(existing);
  return names.map((name) => {
    if (!existing.has(name)) {
      taken.add(name);
      return { name, action: "create" };
    }
    if (onConflict === "replace") return { name, action: "replace" };
    if (onConflict === "skip") return { name, action: "skip" };
    const free = freeName(name, taken);
    taken.add(free);
    return { name: free, action: "rename" };
  });
}
