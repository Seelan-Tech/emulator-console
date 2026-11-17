export const arnName = (arn: string) => arn.split(":").pop() ?? arn;
export const isFifoTopic = (nameOrArn: string) => arnName(nameOrArn).endsWith(".fifo");

// https://sqs.<region>.amazonaws.com/<account>/<name>  ->  arn:aws:sqs:<region>:<account>:<name>
export function queueArnFromUrl(url: string, region: string): string {
  const p = url.split("/");
  return `arn:aws:sqs:${region}:${p[3]}:${p[4]}`;
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
