import { OpError } from "@/lib/aws-client";

import { addTopicToQueuePolicy, arnName, arnRegion, lambdaStatementId } from "./logic";

type Run = <Out = unknown>(svc: "sqs" | "lambda", op: string, input: unknown, o?: { region?: string }) => Promise<Out>;

// An SQS queue only accepts messages from SNS if its policy allows the topic. Read-modify-write, so the rest of the
// policy is kept. The queue may live in another region than the console's.
export async function allowTopicOnQueue(run: Run, queueArn: string, topicArn: string) {
  const region = arnRegion(queueArn);
  const { QueueUrl } = await run<{ QueueUrl: string }>(
    "sqs",
    "GetQueueUrl",
    { QueueName: arnName(queueArn) },
    { region },
  );
  const { Attributes } = await run<{ Attributes?: { Policy?: string } }>(
    "sqs",
    "GetQueueAttributes",
    { QueueUrl, AttributeNames: ["Policy"] },
    { region },
  );
  await run(
    "sqs",
    "SetQueueAttributes",
    { QueueUrl, Attributes: { Policy: addTopicToQueuePolicy(Attributes?.Policy, queueArn, topicArn) } },
    { region },
  );
}

// Without this permission SNS cannot invoke the function, and nothing tells you so.
export async function allowTopicOnFunction(run: Run, functionArn: string, topicArn: string) {
  await run("lambda", "AddPermission", {
    FunctionName: functionArn,
    StatementId: lambdaStatementId(topicArn),
    Action: "lambda:InvokeFunction",
    Principal: "sns.amazonaws.com",
    SourceArn: topicArn,
  }).catch((e: unknown) => {
    // already allowed (this topic was subscribed before): nothing to add
    if (!(e instanceof OpError && e.awsName === "ResourceConflictException")) throw e;
  });
}
