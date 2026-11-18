// Turns a call the console made (service, operation, input) into the AWS CLI command that makes the same call, using
// --cli-input-json so the input is the same JSON the console already holds. Needs the exports from "Use with the AWS CLI".

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

export type CliCall = { service: string; operation: string; input?: unknown; region?: string };

export function cliCommand({ service, operation, input, region }: CliCall): string {
  const data = forCli(input ?? {}) as Record<string, unknown>;
  const parts = ["aws", CLI_SERVICE[service] ?? service, cliOperation(operation)];
  if (region) parts.push("--region", region);
  // `aws lambda invoke` refuses --cli-input-json (it reports --function-name as missing) and needs an output file.
  // The SDK takes the payload as a plain string; the CLI (v2) reads it as base64.
  if (service === "lambda" && operation === "Invoke") {
    for (const [k, v] of Object.entries(data))
      if (typeof v === "string") parts.push(`--${cliOperation(k)}`, shellQuote(k === "Payload" ? toBase64(v) : v));
    parts.push("response.json");
    return parts.join(" ");
  }
  if (Object.keys(data).length) parts.push("--cli-input-json", shellQuote(JSON.stringify(data)));
  return parts.join(" ");
}

// Several steps as a shell script: the same commands in order, with a sleep where a replay would pause.
export function cliScript(steps: (CliCall & { delayAfterMs?: number })[]): string {
  const lines = ['# Run the exports from the console\'s "Use with the AWS CLI" first.'];
  for (const s of steps) {
    lines.push(cliCommand(s));
    if (s.delayAfterMs) lines.push(`sleep ${Math.ceil(s.delayAfterMs / 1000)}`);
  }
  return lines.join("\n");
}
