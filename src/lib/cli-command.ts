// Turns a call the console made (service, operation, input) into the AWS CLI command that makes the same call, using
// --cli-input-json so the input is the same JSON the console already holds. Needs the exports from "Use with the AWS CLI".

import { VAR_REF } from "./fixture-vars";
import type { Expectation } from "./schemas";

// The AWS CLI names a few services differently from the SDK clients.
const CLI_SERVICE: Record<string, string> = { s3: "s3api", eventbridge: "events", sfn: "stepfunctions" };

// ListObjectsV2 -> list-objects-v2, AssumeRoleWithSAML -> assume-role-with-saml
export const cliOperation = (op: string) =>
  op
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

const toBase64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

// The console sends blobs as {"$base64": "..."}; the CLI's JSON input wants the base64 string itself.
function forCli(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forCli);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$base64" && typeof o.$base64 === "string") return o.$base64;
    return Object.fromEntries(keys.map((k) => [k, forCli(o[k])]));
  }
  return value;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
// A fixture variable inside a quoted argument: close the quote, use the shell variable, reopen it.
const shellVars = (quoted: string) => quoted.replace(VAR_REF, (_, name: string) => `'"$${name}"'`);

export type CliCall = { service: string; operation: string; input?: unknown; region?: string };

export function cliCommand({ service, operation, input, region }: CliCall): string {
  const data = forCli(input ?? {}) as Record<string, unknown>;
  const parts = ["aws", CLI_SERVICE[service] ?? service, cliOperation(operation)];
  if (region) parts.push("--region", region);
  // `aws lambda invoke` refuses --cli-input-json (it reports --function-name as missing) and needs an output file.
  // The SDK takes the payload as a plain string; the CLI (v2) reads it as base64.
  if (service === "lambda" && operation === "Invoke") {
    for (const [k, v] of Object.entries(data))
      if (typeof v === "string")
        parts.push(`--${cliOperation(k)}`, k === "Payload" ? shellQuote(toBase64(v)) : shellVars(shellQuote(v)));
    parts.push("response.json");
    return parts.join(" ");
  }
  if (Object.keys(data).length) parts.push("--cli-input-json", shellVars(shellQuote(JSON.stringify(data))));
  return parts.join(" ");
}

// What `aws --output text` prints for a scalar, so an `equals` can be compared as text.
function asCliText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  return v === null ? "None" : null;
}

// The shell test for one check of an assertion, or why it has none.
function cliCheck(call: CliCall, e: Expectation): { test: string } | { skip: string } {
  const read = (query: string) => `${cliCommand(call)} --query ${shellVars(shellQuote(query))} --output text`;
  const text = (v: unknown) => shellVars(shellQuote(asCliText(v) ?? ""));
  if (Object.hasOwn(e, "equals") || Object.hasOwn(e, "notEquals")) {
    const [op, want] = Object.hasOwn(e, "equals") ? ["=", e.equals] : ["!=", e.notEquals];
    if (asCliText(want) === null) return { skip: `${e.path}: a list or object cannot be compared in a script` };
    const eq = `[ "$(${read(e.path)})" = ${text(want)} ]`;
    // A failed call prints nothing, so a notEquals also asks for something to compare
    return { test: op === "=" ? eq : `[ -n "$(${read(e.path)})" ] && [ "$(${read(e.path)})" != ${text(want)} ]` };
  }
  if (e.exists !== undefined) return { test: `[ "$(${read(`${e.path} != null`)})" = ${e.exists ? "True" : "False"} ]` };
  if (e.length !== undefined) return { test: `[ "$(${read(`length(${e.path})`)})" = ${e.length} ]` };
  if (e.contains !== undefined) {
    if (typeof e.contains !== "string" || /['\\]/.test(e.contains))
      return { skip: `${e.path}: contains is exported for plain text only` };
    return { test: `[ "$(${read(`contains(${e.path}, '${e.contains}')`)})" = True ]` };
  }
  for (const [key, op] of [
    ["gt", ">"],
    ["gte", ">="],
    ["lt", "<"],
    ["lte", "<="],
  ] as const) {
    const n = e[key];
    if (n !== undefined)
      return { test: `awk -v v="$(${read(e.path)})" 'BEGIN { exit !(v != "" && v + 0 ${op} ${n}) }'` };
  }
  return { skip: `${e.path}: matches is not exported (shell patterns differ from JavaScript ones)` };
}

type ScriptStep = CliCall & {
  delayAfterMs?: number;
  capture?: Record<string, string>;
  expect?: Expectation[];
  retries?: number;
  retryDelayMs?: number;
};

// An assertion as shell: the read is repeated like a replay repeats it, and the script stops when a check does not hold.
function cliAssertion(s: ScriptStep): string[] {
  const tests: string[] = [];
  const lines: string[] = [];
  for (const e of s.expect!) {
    const c = cliCheck(s, e);
    if ("test" in c) tests.push(c.test);
    else lines.push(`# not exported: ${c.skip}`);
  }
  if (!tests.length) return lines;
  const cond = tests.join(" && ");
  const fail = `{ echo 'check failed: ${s.service}.${s.operation}' >&2; exit 1; }`;
  const tries = (s.retries ?? 0) + 1;
  if (tries === 1) return [...lines, `${cond} || ${fail}`];
  const wait = Math.max(1, Math.ceil((s.retryDelayMs ?? 1000) / 1000));
  return [
    ...lines,
    "ec_ok=0",
    `for ec_try in ${Array.from({ length: tries }, (_, i) => i + 1).join(" ")}; do`,
    `  if ${cond}; then ec_ok=1; break; fi`,
    `  [ "$ec_try" = ${tries} ] || sleep ${wait}`,
    "done",
    `[ "$ec_ok" = 1 ] || ${fail}`,
  ];
}

// Several steps as a shell script: the same commands in order, with a sleep where a replay would pause.
// A step that captures values reads them from the response (`--query`) into shell variables for the steps after it.
// An assertion (`expect`) becomes tests that stop the script with an error when a check does not hold.
export function cliScript(steps: ScriptStep[]): string {
  const lines = ['# Run the exports from the console\'s "Use with the AWS CLI" first.'];
  for (const s of steps) {
    const names = Object.keys(s.capture ?? {});
    if (s.expect?.length) lines.push(...cliAssertion(s));
    if (names.length) {
      const query = `[${Object.values(s.capture!).join(", ")}]`;
      lines.push(`read -r ${names.join(" ")} <<<"$(${cliCommand(s)} --query ${shellQuote(query)} --output text)"`);
    } else if (!s.expect?.length) lines.push(cliCommand(s));
    if (s.delayAfterMs) lines.push(`sleep ${Math.ceil(s.delayAfterMs / 1000)}`);
  }
  return lines.join("\n");
}
