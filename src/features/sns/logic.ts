export const arnName = (arn: string) => arn.split(":").pop() ?? arn;
export const isFifoTopic = (nameOrArn: string) => arnName(nameOrArn).endsWith(".fifo");

// https://sqs.<region>.amazonaws.com/<account>/<name>  ->  arn:aws:sqs:<region>:<account>:<name>
export function queueArnFromUrl(url: string, region: string): string {
  const p = url.split("/");
  return `arn:aws:sqs:${region}:${p[3]}:${p[4]}`;
}

// A Lambda function only accepts invocations from SNS if its resource policy allows the topic (a missing permission
// fails silently: nothing is delivered and no log group appears). The statement id includes the region, so topics of
// the same name in two regions get their own statements; ids allow letters, digits, hyphens and underscores.
export function lambdaStatementId(topicArn: string): string {
  const [, , , region, , name] = topicArn.split(":");
  return `sns-${region}-${name}`.replace(/[^\w-]/g, "-").slice(0, 100);
}

type Statement = { Sid?: string; [k: string]: unknown };
type Policy = { Version?: string; Statement?: Statement[] };

// An SQS queue only accepts messages from SNS if its policy allows the topic. Adds (or replaces) one statement
// for this topic and keeps everything else in the existing policy.
export function addTopicToQueuePolicy(existing: string | undefined, queueArn: string, topicArn: string): string {
  const policy: Policy = existing ? (JSON.parse(existing) as Policy) : { Version: "2012-10-17", Statement: [] };
  const Sid = `sns-${arnName(topicArn)}`.replace(/[^\w-]/g, "-");
  const statements = (policy.Statement ?? []).filter((s) => s.Sid !== Sid);
  statements.push({
    Sid,
    Effect: "Allow",
    Principal: { Service: "sns.amazonaws.com" },
    Action: "sqs:SendMessage",
    Resource: queueArn,
    Condition: { ArnEquals: { "aws:SourceArn": topicArn } },
  });
  return JSON.stringify({ ...policy, Statement: statements });
}

export const PROTOCOLS = ["sqs", "lambda", "http", "https", "email", "sms"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const endpointHint: Record<Protocol, string> = {
  sqs: "Queue ARN",
  lambda: "Function ARN",
  http: "http://…",
  https: "https://…",
  email: "name@example.com",
  sms: "+15555550100",
};

// The emulator never confirms these subscriptions (no confirmation message is sent), so nothing is delivered to them.
export const deliversOnEmulator = (p: Protocol) => p === "sqs" || p === "lambda";

// What SNS (and the emulator) reject about an endpoint before it ever gets a confirmation message: an http subscription
// takes an http:// URL and an https one an https:// URL, nothing else. Undefined when the endpoint looks usable.
export function endpointProblem(protocol: Protocol, endpoint: string): string | undefined {
  const e = endpoint.trim();
  if (!e || (protocol !== "http" && protocol !== "https")) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(e)?.[1]?.toLowerCase();
  if (!scheme) return `An ${protocol} endpoint is a URL that starts with ${protocol}://`;
  if (scheme !== "http" && scheme !== "https") return `${scheme}:// is not supported: use an http:// or https:// URL`;
  if (scheme !== protocol)
    return `This is an ${scheme}:// URL: choose the ${scheme} protocol for it (an ${protocol} subscription needs ${protocol}://)`;
  try {
    if (!new URL(e).hostname) throw new Error("no host");
  } catch {
    return "This is not a valid URL";
  }
  return undefined;
}

// Raw delivery only applies to endpoints that receive the message body directly.
export const supportsRawDelivery = (p: Protocol) => p === "sqs" || p === "http" || p === "https";

// --- Subscription health: will the emulator deliver to this subscription? -----------------------------------------

export const arnRegion = (arn: string) => arn.split(":")[3] || undefined;

type Cond = Record<string, Record<string, string | string[]>>;
type Stmt = {
  Effect?: string;
  Principal?: unknown;
  Action?: string | string[];
  Condition?: Cond;
};

const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const globMatch = (pattern: string, value: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  ).test(value);

const SNS_SERVICE = "sns.amazonaws.com";

function principalIs(p: unknown, service: string): boolean {
  if (p === "*") return true;
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, string | string[]>;
  return list(o.Service).some((v) => v === service) || list(o.AWS).some((v) => v === "*");
}

// Does the resource policy let `service` (sns.amazonaws.com, events.amazonaws.com) call `action` for this source?
// Statements that name another source do not count; a statement with no source condition (or only other
// conditions, such as the account) allows any source.
export function policyAllowsSource(
  policy: string | undefined,
  service: string,
  sourceArn: string,
  action: string,
): boolean {
  if (!policy) return false;
  let statements: Stmt[];
  try {
    const p = JSON.parse(policy) as { Statement?: Stmt | Stmt[] };
    statements = list(p.Statement);
  } catch {
    return false;
  }
  return statements.some((s) => {
    if (s.Effect !== "Allow" || !principalIs(s.Principal, service)) return false;
    if (!list(s.Action).some((a) => a === "*" || globMatch(a, action))) return false;
    for (const [op, keys] of Object.entries(s.Condition ?? {})) {
      for (const [key, v] of Object.entries(keys)) {
        if (key.toLowerCase() !== "aws:sourcearn") continue;
        const wanted = list(v);
        const matches = /like/i.test(op) ? wanted.some((w) => globMatch(w, sourceArn)) : wanted.includes(sourceArn);
        if (!matches) return false;
      }
    }
    return true;
  });
}

// The same question for an SNS topic.
export const policyAllowsTopic = (policy: string | undefined, topicArn: string, action: string) =>
  policyAllowsSource(policy, SNS_SERVICE, topicArn, action);

export type Health = "delivers" | "needs-permission" | "missing" | "unknown";

// What was found at the endpoint: it does not exist, or it exists (with its resource policy, if it has one).
export type EndpointState = { exists: false } | { exists: true; policy?: string };

export function subscriptionHealth(protocol: string, endpoint: EndpointState, topicArn: string): Health {
  if (!endpoint.exists) return "missing";
  const action = protocol === "lambda" ? "lambda:InvokeFunction" : "sqs:SendMessage";
  return policyAllowsTopic(endpoint.policy, topicArn, action) ? "delivers" : "needs-permission";
}
