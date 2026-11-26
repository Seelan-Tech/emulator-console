import type { Step } from "./schemas";

// Ready-made assertions for the fixture editor: pick one, fill in the names, and the step is added to the fixture.
// Each reads something the emulator holds and checks it, with the retries that state arriving late needs.

export type TemplateField = { key: string; label: string; placeholder: string; value?: string };
export type AssertionTemplate = {
  id: string;
  label: string;
  fields: TemplateField[];
  build: (
    v: Record<string, string>,
  ) => Pick<Step, "service" | "operation" | "input" | "expect" | "retries" | "retryDelayMs">;
};

const count = (v: string) => Number(v.trim());
const COUNT: TemplateField = { key: "count", label: "How many", placeholder: "0", value: "0" };

export const ASSERTION_TEMPLATES: AssertionTemplate[] = [
  {
    id: "queue-messages",
    label: "A queue has N messages",
    fields: [{ key: "queueUrl", label: "Queue URL", placeholder: "http://… or {{queueUrl}}" }, COUNT],
    build: (v) => ({
      service: "sqs",
      operation: "GetQueueAttributes",
      input: { QueueUrl: v.queueUrl, AttributeNames: ["ApproximateNumberOfMessages"] },
      // SQS reports attributes as text
      expect: [{ path: "Attributes.ApproximateNumberOfMessages", equals: String(count(v.count!)) }],
      retries: 5,
      retryDelayMs: 1000,
    }),
  },
  {
    id: "table-items",
    label: "A table has N items",
    fields: [{ key: "table", label: "Table name", placeholder: "orders" }, COUNT],
    build: (v) => ({
      service: "dynamodb",
      operation: "Scan",
      input: { TableName: v.table, Select: "COUNT" },
      expect: [{ path: "Count", equals: count(v.count!) }],
      retries: 3,
      retryDelayMs: 1000,
    }),
  },
  {
    id: "object-exists",
    label: "An S3 object exists",
    fields: [
      { key: "bucket", label: "Bucket", placeholder: "my-bucket" },
      { key: "key", label: "Key", placeholder: "path/to/file.txt" },
    ],
    build: (v) => ({
      service: "s3",
      operation: "HeadObject",
      input: { Bucket: v.bucket, Key: v.key },
      expect: [{ path: "ContentLength", exists: true }],
      retries: 3,
      retryDelayMs: 1000,
    }),
  },
  {
    id: "function-active",
    label: "A Lambda function is Active",
    fields: [{ key: "fn", label: "Function name", placeholder: "my-function" }],
    build: (v) => ({
      service: "lambda",
      operation: "GetFunction",
      input: { FunctionName: v.fn },
      expect: [{ path: "Configuration.State", equals: "Active" }],
      retries: 10,
      retryDelayMs: 1000,
    }),
  },
  {
    id: "topic-subscriptions",
    label: "An SNS topic has N subscriptions",
    fields: [{ key: "topicArn", label: "Topic ARN", placeholder: "arn:aws:sns:… or {{topicArn}}" }, COUNT],
    build: (v) => ({
      service: "sns",
      operation: "ListSubscriptionsByTopic",
      input: { TopicArn: v.topicArn },
      expect: [{ path: "Subscriptions", length: count(v.count!) }],
      retries: 3,
      retryDelayMs: 1000,
    }),
  },
  {
    id: "secret-exists",
    label: "A secret exists",
    fields: [{ key: "secret", label: "Secret name or ARN", placeholder: "app/db-password" }],
    build: (v) => ({
      service: "secretsmanager",
      operation: "DescribeSecret",
      input: { SecretId: v.secret },
      expect: [{ path: "Name", exists: true }],
      retries: 3,
      retryDelayMs: 1000,
    }),
  },
];

// The step for a template and the values typed in, or what is wrong with them.
export function assertionStep(id: string, values: Record<string, string>): { step: Step } | { error: string } {
  const t = ASSERTION_TEMPLATES.find((x) => x.id === id);
  if (!t) return { error: "Choose an assertion" };
  const v = Object.fromEntries(t.fields.map((f) => [f.key, (values[f.key] ?? f.value ?? "").trim()]));
  for (const f of t.fields) if (!v[f.key]) return { error: `${f.label} is required` };
  if ("count" in v && !/^\d{1,9}$/.test(v.count)) return { error: "How many must be a whole number, 0 or more" };
  return { step: { delayAfterMs: 0, ...t.build(v) } };
}
