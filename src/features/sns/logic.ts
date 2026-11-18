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

// Raw delivery only applies to endpoints that receive the message body directly.
export const supportsRawDelivery = (p: Protocol) => p === "sqs" || p === "http" || p === "https";

// --- Subscription health -------------------------------------------------------------------------------------------
// SNS delivers to SQS and Lambda only if the target's resource policy lets the topic in, and says nothing when it
// doesn't. These checks read that policy and report whether a subscription can actually deliver.

type Condition = Record<string, Record<string, string | string[]>>;
type PolicyStatement = {
  Effect?: string;
  Principal?: string | { Service?: string | string[]; AWS?: string | string[] };
  Action?: string | string[];
  Condition?: Condition;
};

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// IAM-style wildcard match (`*` and `?`), case-sensitive.
function wildcard(pattern: string, value: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(value);
}

function principalIsSns(p: PolicyStatement["Principal"]): boolean {
  if (p === "*") return true;
  if (!p || typeof p !== "object") return false;
  return [...list(p.Service), ...list(p.AWS)].some((x) => x === "*" || x === "sns.amazonaws.com");
}

function actionMatches(s: PolicyStatement, action: string): boolean {
  return list(s.Action).some((a) => wildcard(a.toLowerCase(), action.toLowerCase()));
}

// A statement without an aws:SourceArn condition admits every topic; one with it must name this topic.
function sourceArnAdmits(c: Condition | undefined, topicArn: string): boolean {
  if (!c) return true;
  let constrained = false;
  for (const [operator, kv] of Object.entries(c)) {
    for (const [key, v] of Object.entries(kv)) {
      if (key.toLowerCase() !== "aws:sourcearn") continue;
      constrained = true;
      const op = operator.replace(/IfExists$/, "");
      if (op === "ArnEquals" || op === "ArnLike" || op === "StringEquals" || op === "StringLike") {
        if (list(v).some((x) => wildcard(x, topicArn))) return true;
      }
    }
  }
  // Other conditions (source account, ...) are not evaluated; they are not a SourceArn restriction.
  return !constrained;
}

function topicAllowed(policy: string | undefined, action: string, topicArn: string): boolean {
  if (!policy) return false;
  let statements: PolicyStatement[];
  try {
    const { Statement } = JSON.parse(policy) as { Statement?: PolicyStatement | PolicyStatement[] };
    statements = Array.isArray(Statement) ? Statement : Statement ? [Statement] : [];
  } catch {
    return false;
  }
  const relevant = statements.filter((s) => principalIsSns(s.Principal) && actionMatches(s, action));
  const hit = (effect: string) =>
    relevant.some((s) => (s.Effect ?? "Allow") === effect && sourceArnAdmits(s.Condition, topicArn));
  return hit("Allow") && !hit("Deny");
}

export const queuePolicyAllowsTopic = (policy: string | undefined, topicArn: string) =>
  topicAllowed(policy, "sqs:SendMessage", topicArn);

export const functionPolicyAllowsTopic = (policy: string | undefined, topicArn: string) =>
  topicAllowed(policy, "lambda:InvokeFunction", topicArn);

export type HealthFix = "queue-policy" | "lambda-permission";
export type Health = { status: "ok" | "warn" | "error" | "unknown"; message: string; fix?: HealthFix };

// What was found when the subscription's target was looked up; `undefined` means it could not be read.
export type TargetState = { exists: false } | { exists: true; policy?: string } | undefined;

export function subscriptionHealth(
  sub: { SubscriptionArn: string; Protocol: string; Endpoint: string },
  topicArn: string,
  target: TargetState,
): Health {
  const p = sub.Protocol as Protocol;
  if (!deliversOnEmulator(p)) return { status: "warn", message: `The emulator never delivers to ${p} endpoints` };
  if (sub.SubscriptionArn === "PendingConfirmation") return { status: "warn", message: "Never confirmed" };
  if (!target) return { status: "unknown", message: "Could not check the target" };
  if (p === "sqs") {
    if (!target.exists) return { status: "error", message: "The queue does not exist" };
    return queuePolicyAllowsTopic(target.policy, topicArn)
      ? { status: "ok", message: "The queue policy allows this topic" }
      : { status: "error", message: "The queue policy does not allow this topic", fix: "queue-policy" };
  }
  if (!target.exists) return { status: "error", message: "The function does not exist" };
  return functionPolicyAllowsTopic(target.policy, topicArn)
    ? { status: "ok", message: "The function allows this topic to invoke it" }
    : { status: "error", message: "The function does not allow this topic to invoke it", fix: "lambda-permission" };
}
