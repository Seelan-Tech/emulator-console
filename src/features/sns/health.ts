import { useQuery } from "@tanstack/react-query";

import { useTarget } from "@/components/target-context";
import { callOp, OpError } from "@/lib/aws-client";

import { arnName, arnRegion, type EndpointState, type Health, subscriptionHealth } from "./logic";

export type SubLike = { SubscriptionArn: string; Protocol: string; Endpoint: string };

const isMissing = (e: unknown) =>
  e instanceof OpError && /ResourceNotFound|NonExistentQueue|QueueDoesNotExist/.test(e.awsName ?? "");

// The function or queue a subscription delivers to, and the policy that decides whether the topic may use it.
export async function inspect(tid: string, s: SubLike, fallbackRegion: string): Promise<EndpointState> {
  const region = arnRegion(s.Endpoint) ?? fallbackRegion;
  try {
    if (s.Protocol === "lambda") {
      try {
        const { Policy } = await callOp<{ Policy?: string }>(
          tid,
          "lambda",
          "GetPolicy",
          { FunctionName: s.Endpoint },
          region,
        );
        return { exists: true, policy: Policy };
      } catch (e) {
        if (!isMissing(e)) throw e;
        // no policy at all, or no function: only the function itself tells them apart
        await callOp(tid, "lambda", "GetFunctionConfiguration", { FunctionName: s.Endpoint }, region);
        return { exists: true };
      }
    }
    const { QueueUrl } = await callOp<{ QueueUrl: string }>(
      tid,
      "sqs",
      "GetQueueUrl",
      { QueueName: arnName(s.Endpoint) },
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
  } catch (e) {
    if (isMissing(e)) return { exists: false };
    throw e;
  }
}

// Whether each confirmed sqs/lambda subscription of a topic will actually be delivered to. One endpoint at a time (the
// emulator drops parallel bursts); a check that fails is "unknown", not an error for the page.
export function useSubscriptionHealth(topicArn: string | undefined, subs: SubLike[]) {
  const { tid, region } = useTarget();
  const checked = subs.filter(
    (s) => (s.Protocol === "sqs" || s.Protocol === "lambda") && s.SubscriptionArn !== "PendingConfirmation",
  );
  const key = checked.map((s) => `${s.Protocol}:${s.Endpoint}`).join(",");
  return useQuery({
    queryKey: [tid, "sns", "subscription-health", topicArn, region, key],
    enabled: !!topicArn && checked.length > 0,
    queryFn: async () => {
      const out: Record<string, Health> = {};
      for (const s of checked) {
        try {
          out[s.SubscriptionArn] = subscriptionHealth(s.Protocol, await inspect(tid, s, region), topicArn!);
        } catch {
          out[s.SubscriptionArn] = "unknown";
        }
      }
      return out;
    },
  });
}
