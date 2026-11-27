import { useQuery } from "@tanstack/react-query";

import { useTarget } from "@/components/target-context";
import { callOp, OpError } from "@/lib/aws-client";

import { arnName, arnRegion, type EndpointState, type Health } from "../sns/logic";
import { targetHealth, targetKind } from "./logic";

export type Target = { Id: string; Arn: string; Input?: string; InputPath?: string };
export type TargetHealth = Health | "not-checked";

const isMissing = (e: unknown) =>
  e instanceof OpError && /ResourceNotFound|NonExistentQueue|QueueDoesNotExist|NotFound/.test(e.awsName ?? "");

// The queue, function or topic a target points at, and the policy that decides whether the rule may use it.
export async function inspectTarget(tid: string, arn: string, fallbackRegion: string): Promise<EndpointState> {
  const region = arnRegion(arn) ?? fallbackRegion;
  try {
    switch (targetKind(arn)) {
      case "lambda": {
        try {
          const { Policy } = await callOp<{ Policy?: string }>(
            tid,
            "lambda",
            "GetPolicy",
            { FunctionName: arn },
            region,
          );
          return { exists: true, policy: Policy };
        } catch (e) {
          if (!isMissing(e)) throw e;
          // no policy at all, or no function: only the function itself tells them apart
          await callOp(tid, "lambda", "GetFunctionConfiguration", { FunctionName: arn }, region);
          return { exists: true };
        }
      }
      case "sns": {
        const { Attributes } = await callOp<{ Attributes?: { Policy?: string } }>(
          tid,
          "sns",
          "GetTopicAttributes",
          { TopicArn: arn },
          region,
        );
        return { exists: true, policy: Attributes?.Policy };
      }
      default: {
        const { QueueUrl } = await callOp<{ QueueUrl: string }>(
          tid,
          "sqs",
          "GetQueueUrl",
          { QueueName: arnName(arn) },
          region,
        );
        const { Attributes } = await callOp<{ Attributes?: { Policy?: string } }>(
          tid,
          "sqs",
          "GetQueueAttributes",
          { QueueUrl, AttributeNames: ["Policy"] },
          region,
        );
        return { exists: true, policy: Attributes?.Policy };
      }
    }
  } catch (e) {
    if (isMissing(e)) return { exists: false };
    throw e;
  }
}

// Whether each queue, function or topic target of a rule will actually receive from it. One target at a time (the
// emulator drops parallel bursts); a check that fails is "unknown", not an error for the page.
export function useTargetHealth(ruleArn: string | undefined, targets: Target[]) {
  const { tid, region } = useTarget();
  const key = targets.map((t) => `${t.Id}=${t.Arn}`).join(",");
  return useQuery({
    queryKey: [tid, "eventbridge", "target-health", ruleArn, region, key],
    enabled: !!ruleArn && targets.length > 0,
    queryFn: async () => {
      const out: Record<string, TargetHealth> = {};
      for (const t of targets) {
        if (targetKind(t.Arn) === "other") {
          out[t.Id] = "not-checked";
          continue;
        }
        try {
          out[t.Id] = targetHealth(t.Arn, await inspectTarget(tid, t.Arn, region), ruleArn!);
        } catch {
          out[t.Id] = "unknown";
        }
      }
      return out;
    },
  });
}
