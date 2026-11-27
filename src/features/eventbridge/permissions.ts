import { OpError } from "@/lib/aws-client";

import { arnName, arnRegion } from "../sns/logic";
import { addRuleToPolicy, EVENTS_SERVICE, ruleStatementId, targetKind } from "./logic";

type Run = <Out = unknown>(
  svc: "sqs" | "lambda" | "sns",
  op: string,
  input: unknown,
  o?: { region?: string },
) => Promise<Out>;

// Without the rule in the target's policy, EventBridge delivers nothing and nothing says so (the emulator behaves like
// AWS here). Read-modify-write, so the rest of a policy is kept. The target may live in another region than the console's.
export async function allowRuleOnTarget(
  run: Run,
  o: { targetArn: string; ruleArn: string; bus: string; rule: string },
) {
  const region = arnRegion(o.targetArn);
  const ids = { resourceArn: o.targetArn, ruleArn: o.ruleArn, bus: o.bus, rule: o.rule };
  switch (targetKind(o.targetArn)) {
    case "sqs": {
      const { QueueUrl } = await run<{ QueueUrl: string }>(
        "sqs",
        "GetQueueUrl",
        { QueueName: arnName(o.targetArn) },
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
        {
          QueueUrl,
          Attributes: { Policy: addRuleToPolicy(Attributes?.Policy, { ...ids, action: "sqs:SendMessage" }) },
        },
        { region },
      );
      return;
    }
    case "sns": {
      const { Attributes } = await run<{ Attributes?: { Policy?: string } }>(
        "sns",
        "GetTopicAttributes",
        { TopicArn: o.targetArn },
        { region },
      );
      await run(
        "sns",
        "SetTopicAttributes",
        {
          TopicArn: o.targetArn,
          AttributeName: "Policy",
          AttributeValue: addRuleToPolicy(Attributes?.Policy, { ...ids, action: "sns:Publish" }),
        },
        { region },
      );
      return;
    }
    case "lambda":
      await run(
        "lambda",
        "AddPermission",
        {
          FunctionName: o.targetArn,
          StatementId: ruleStatementId(o.bus, o.rule),
          Action: "lambda:InvokeFunction",
          Principal: EVENTS_SERVICE,
          SourceArn: o.ruleArn,
        },
        { region },
      ).catch((e: unknown) => {
        // already allowed (this rule used the function before): nothing to add
        if (!(e instanceof OpError && e.awsName === "ResourceConflictException")) throw e;
      });
      return;
    default:
      throw new Error("Only SQS queues, Lambda functions and SNS topics need a permission");
  }
}
