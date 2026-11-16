import { Agent } from "node:https";

import { NodeHttpHandler } from "@smithy/node-http-handler";

// Static loaders (not computed import paths) so the bundler and standalone tracing include every SDK client.
const loaders = {
  s3: () => import("@aws-sdk/client-s3"),
  dynamodb: () => import("@aws-sdk/client-dynamodb"),
  sqs: () => import("@aws-sdk/client-sqs"),
  sns: () => import("@aws-sdk/client-sns"),
  lambda: () => import("@aws-sdk/client-lambda"),
  iam: () => import("@aws-sdk/client-iam"),
  sts: () => import("@aws-sdk/client-sts"),
  logs: () => import("@aws-sdk/client-cloudwatch-logs"),
  secretsmanager: () => import("@aws-sdk/client-secrets-manager"),
  ssm: () => import("@aws-sdk/client-ssm"),
  sfn: () => import("@aws-sdk/client-sfn"),
  eventbridge: () => import("@aws-sdk/client-eventbridge"),
  kms: () => import("@aws-sdk/client-kms"),
  cloudformation: () => import("@aws-sdk/client-cloudformation"),
  ec2: () => import("@aws-sdk/client-ec2"),
  kinesis: () => import("@aws-sdk/client-kinesis"),
} as const;

export const services = {
  s3: { client: "S3Client", probe: "ListBucketsCommand" },
  dynamodb: { client: "DynamoDBClient", probe: "ListTablesCommand" },
  sqs: { client: "SQSClient", probe: "ListQueuesCommand" },
  sns: { client: "SNSClient", probe: "ListTopicsCommand" },
  lambda: { client: "LambdaClient", probe: "ListFunctionsCommand" },
  iam: { client: "IAMClient", probe: "ListUsersCommand" },
  sts: { client: "STSClient", probe: "GetCallerIdentityCommand" },
  logs: { client: "CloudWatchLogsClient", probe: "DescribeLogGroupsCommand" },
  secretsmanager: { client: "SecretsManagerClient", probe: "ListSecretsCommand" },
  ssm: { client: "SSMClient", probe: "DescribeParametersCommand" },
  sfn: { client: "SFNClient", probe: "ListStateMachinesCommand" },
  eventbridge: { client: "EventBridgeClient", probe: "ListEventBusesCommand" },
  kms: { client: "KMSClient", probe: "ListKeysCommand" },
  cloudformation: { client: "CloudFormationClient", probe: "ListStacksCommand" },
  ec2: { client: "EC2Client", probe: "DescribeVpcsCommand" },
  kinesis: { client: "KinesisClient", probe: "ListStreamsCommand" },
} as const;

export type ServiceName = keyof typeof services;
export const serviceNames = Object.keys(services) as [ServiceName, ...ServiceName[]];
export const isService = (s: string): s is ServiceName => Object.hasOwn(services, s);

// Everything needed to talk to one emulator endpoint. Resolved per request (see targets.ts).
export type Conn = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  ca?: string;
  servername?: string;
};

type SdkModule = Record<string, unknown>;
export const loadService = (service: ServiceName): Promise<SdkModule> => loaders[service]();

export async function operations(service: ServiceName): Promise<string[]> {
  const mod = await loadService(service);
  // Real operations are named like "GetObjectCommand"; the SDK also exports helper keys such as "$Command".
  return Object.keys(mod)
    .filter((k) => /^[A-Z][A-Za-z0-9]*Command$/.test(k))
    .map((k) => k.slice(0, -"Command".length))
    .sort();
}

// The SDK exposes clients and commands as classes looked up by name, so the boundary is typed structurally.
type SdkCommand = new (input: unknown) => object;
type SdkClient = { send(command: object): Promise<unknown>; destroy(): void };
type SdkClientCtor = new (config: Record<string, unknown>) => SdkClient;
type StreamBody = { transformToByteArray(): Promise<Uint8Array> };

const hasStreamBody = (out: unknown): out is { Body: StreamBody } =>
  typeof out === "object" &&
  out !== null &&
  "Body" in out &&
  typeof out.Body === "object" &&
  out.Body !== null &&
  "transformToByteArray" in out.Body &&
  typeof out.Body.transformToByteArray === "function";

export async function run<T = unknown>(
  conn: Conn,
  service: ServiceName,
  command: string,
  input: unknown,
  region = conn.region,
): Promise<T> {
  const mod = await loadService(service);
  const Command = mod[command.endsWith("Command") ? command : `${command}Command`] as SdkCommand | undefined;
  if (!Command) throw Object.assign(new Error(`unknown operation ${command}`), { name: "UnknownOperation" });
  const Client = mod[services[service].client] as SdkClientCtor;
  const client = new Client({
    endpoint: conn.endpoint,
    region,
    credentials: { accessKeyId: conn.accessKeyId, secretAccessKey: conn.secretAccessKey },
    requestHandler: new NodeHttpHandler({
      httpsAgent: new Agent({ ca: conn.ca, servername: conn.servername || undefined }),
    }),
    forcePathStyle: true,
  });
  try {
    const out = await client.send(new Command(input ?? {}));
    // Streaming bodies (S3 GetObject) must be read before the client is destroyed, or the transfer aborts.
    if (hasStreamBody(out)) (out as { Body: unknown }).Body = await out.Body.transformToByteArray();
    return out as T;
  } finally {
    client.destroy();
  }
}
