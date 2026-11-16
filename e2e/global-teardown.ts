import { request } from "@playwright/test";

// Every spec removes what it creates. This is the safety net: it looks for anything left behind by a test
// (names start with e2e-, pal-, secret-), removes it so the next run starts clean, and then FAILS the run so the
// leak gets fixed rather than hidden.
const PREFIX = /^(e2e-|pal-|secret-)/;

export default async function globalTeardown(config: { projects: { use: { baseURL?: string } }[] }) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const ctx = await request.newContext({ baseURL });
  const leaks: string[] = [];
  try {
    await ctx.get("/"); // loading the Targets page creates the Local emulator target
    const targets = (await (await ctx.get("/api/targets")).json()) as { id: string; name: string }[];
    const tid = targets.find((t) => t.name === "Local emulator")?.id;
    if (!tid) return;

    const call = async <T>(svc: string, op: string, input: unknown = {}): Promise<T | null> => {
      const r = (await (await ctx.post(`/api/targets/${tid}/${svc}/${op}`, { data: input })).json()) as {
        ok: boolean;
        output?: T;
      };
      return r.ok ? (r.output ?? null) : null;
    };
    const mine = (names: (string | undefined)[] | undefined) =>
      (names ?? []).filter((n): n is string => !!n && PREFIX.test(n));

    for (const b of mine(
      (await call<{ Buckets?: { Name?: string }[] }>("s3", "ListBuckets"))?.Buckets?.map((x) => x.Name),
    )) {
      leaks.push(`s3 bucket ${b}`);
      const objs = await call<{ Contents?: { Key?: string }[] }>("s3", "ListObjectsV2", { Bucket: b });
      for (const o of objs?.Contents ?? []) await call("s3", "DeleteObject", { Bucket: b, Key: o.Key });
      await call("s3", "DeleteBucket", { Bucket: b });
    }
    for (const t of mine((await call<{ TableNames?: string[] }>("dynamodb", "ListTables"))?.TableNames)) {
      leaks.push(`dynamodb table ${t}`);
      for (let i = 0; i < 20 && (await call("dynamodb", "DeleteTable", { TableName: t })) === null; i++)
        await new Promise((r) => setTimeout(r, 500));
    }
    for (const url of (await call<{ QueueUrls?: string[] }>("sqs", "ListQueues"))?.QueueUrls ?? []) {
      if (!PREFIX.test(url.split("/").pop() ?? "")) continue;
      leaks.push(`sqs queue ${url}`);
      await call("sqs", "DeleteQueue", { QueueUrl: url });
    }
    for (const f of mine(
      (await call<{ Functions?: { FunctionName?: string }[] }>("lambda", "ListFunctions"))?.Functions?.map(
        (x) => x.FunctionName,
      ),
    )) {
      leaks.push(`lambda function ${f}`);
      await call("lambda", "DeleteFunction", { FunctionName: f });
    }
    for (const arn of (await call<{ Topics?: { TopicArn?: string }[] }>("sns", "ListTopics"))?.Topics?.map(
      (x) => x.TopicArn,
    ) ?? []) {
      if (!arn || !PREFIX.test(arn.split(":").pop() ?? "")) continue;
      leaks.push(`sns topic ${arn}`);
      await call("sns", "DeleteTopic", { TopicArn: arn });
    }
    for (const s of mine(
      (await call<{ SecretList?: { Name?: string }[] }>("secretsmanager", "ListSecrets"))?.SecretList?.map(
        (x) => x.Name,
      ),
    )) {
      leaks.push(`secret ${s}`);
      await call("secretsmanager", "DeleteSecret", { SecretId: s, ForceDeleteWithoutRecovery: true });
    }
  } finally {
    await ctx.dispose();
  }
  if (leaks.length)
    throw new Error(`e2e tests leaked ${leaks.length} resource(s) (now removed):\n  ${leaks.join("\n  ")}`);
}
