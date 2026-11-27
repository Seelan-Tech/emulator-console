import { callOp } from "@/lib/aws-client";

import { inspectTarget } from "../eventbridge/health";
import { targetHealth, targetKind } from "../eventbridge/logic";
import { inspect } from "../sns/health";
import { arnRegion, type Health, subscriptionHealth } from "../sns/logic";
import { counts } from "../sqs/logic";
import type { EdgeHealth, FlowInput } from "./graph";

type Sub = { SubscriptionArn: string; Protocol: string; Endpoint: string };
type Parts = Omit<FlowInput, "base">;

// Pages through a list call. The loop is bounded: an emulator that keeps answering with a token must not hang the page.
async function all<T>(read: (token?: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await read(token);
    out.push(...r.items);
    token = r.next;
    if (!token) break;
  }
  return out;
}

// Reads every topic, queue, function and event source mapping of a target, one call at a time (the emulator drops
// parallel bursts). A service that fails to answer leaves its part empty and adds a warning: the rest still draws.
export async function loadFlow(tid: string, region: string): Promise<{ parts: Parts; warnings: string[] }> {
  const warnings: string[] = [];
  const soft = async <T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      warnings.push(`${what}: ${(e as Error).message}`);
      return fallback;
    }
  };

  const queues = await soft("SQS", [] as Parts["queues"], async () => {
    const { QueueUrls = [] } = await callOp<{ QueueUrls?: string[] }>(tid, "sqs", "ListQueues", {}, region);
    const out: (Parts["queues"][number] & { policy?: string })[] = [];
    for (const url of QueueUrls) {
      const { Attributes = {} } = await callOp<{ Attributes?: Record<string, string> }>(
        tid,
        "sqs",
        "GetQueueAttributes",
        { QueueUrl: url, AttributeNames: ["All"] },
        region,
      );
      let dead: string | undefined;
      try {
        dead = (JSON.parse(Attributes.RedrivePolicy ?? "null") as { deadLetterTargetArn?: string } | null)
          ?.deadLetterTargetArn;
      } catch {
        // a policy that is not JSON has no dead-letter queue we can name
      }
      const c = counts(Attributes);
      out.push({
        url,
        name: url.split("/").pop() ?? url,
        arn: Attributes.QueueArn ?? "",
        ...c,
        ...(dead ? { deadLetterTargetArn: dead } : {}),
        policy: Attributes.Policy,
      });
    }
    return out.filter((q) => q.arn);
  });
  const policyOf = new Map(queues.map((q) => [q.arn, (q as { policy?: string }).policy]));

  const functions = await soft("Lambda", [] as Parts["functions"], () =>
    all(async (Marker) => {
      const r = await callOp<{ Functions?: { FunctionName: string; FunctionArn: string }[]; NextMarker?: string }>(
        tid,
        "lambda",
        "ListFunctions",
        Marker ? { Marker } : {},
        region,
      );
      return {
        items: (r.Functions ?? []).map((f) => ({ name: f.FunctionName, arn: f.FunctionArn })),
        next: r.NextMarker,
      };
    }),
  );

  const mappings = await soft("Lambda event sources", [] as Parts["mappings"], () =>
    all(async (Marker) => {
      const r = await callOp<{
        EventSourceMappings?: { UUID: string; FunctionArn: string; EventSourceArn: string; State?: string }[];
        NextMarker?: string;
      }>(tid, "lambda", "ListEventSourceMappings", Marker ? { Marker } : {}, region);
      return {
        items: (r.EventSourceMappings ?? []).flatMap((m) =>
          m.FunctionArn && m.EventSourceArn
            ? [{ id: m.UUID, functionArn: m.FunctionArn, eventSourceArn: m.EventSourceArn, state: m.State }]
            : [],
        ),
        next: r.NextMarker,
      };
    }),
  );

  const topics = await soft("SNS", [] as Parts["topics"], async () => {
    const { Topics = [] } = await callOp<{ Topics?: { TopicArn: string }[] }>(tid, "sns", "ListTopics", {}, region);
    const out: Parts["topics"] = [];
    for (const t of Topics) {
      const subs = await all<Sub>(async (NextToken) => {
        const r = await callOp<{ Subscriptions?: Sub[]; NextToken?: string }>(
          tid,
          "sns",
          "ListSubscriptionsByTopic",
          { TopicArn: t.TopicArn, ...(NextToken ? { NextToken } : {}) },
          region,
        );
        return { items: r.Subscriptions ?? [], next: r.NextToken };
      });
      const subscriptions: Parts["topics"][number]["subscriptions"] = [];
      for (const s of subs) {
        let health: Health | undefined;
        if ((s.Protocol === "sqs" || s.Protocol === "lambda") && s.SubscriptionArn !== "PendingConfirmation") {
          const sameRegion = (arnRegion(s.Endpoint) ?? region) === region;
          try {
            health =
              // a queue this page has already read needs no second look at its policy
              s.Protocol === "sqs" && sameRegion
                ? subscriptionHealth(
                    "sqs",
                    policyOf.has(s.Endpoint) ? { exists: true, policy: policyOf.get(s.Endpoint) } : { exists: false },
                    t.TopicArn,
                  )
                : subscriptionHealth(s.Protocol, await inspect(tid, s, region), t.TopicArn);
          } catch {
            health = "unknown";
          }
        }
        subscriptions.push({ arn: s.SubscriptionArn, protocol: s.Protocol, endpoint: s.Endpoint, health });
      }
      out.push({ arn: t.TopicArn, subscriptions });
    }
    return out;
  });

  // Every rule of every bus with its targets, and whether each queue, function or topic target will receive from it.
  const rules = await soft("EventBridge", [] as NonNullable<Parts["rules"]>, async () => {
    const { EventBuses = [] } = await callOp<{ EventBuses?: { Name: string; Arn: string }[] }>(
      tid,
      "eventbridge",
      "ListEventBuses",
      {},
      region,
    );
    const healthOf = async (arn: string, ruleArn: string): Promise<EdgeHealth> => {
      if (targetKind(arn) === "other") return "not-checked";
      try {
        // a queue this page has already read needs no second look at its policy
        if (targetKind(arn) === "sqs" && (arnRegion(arn) ?? region) === region)
          return targetHealth(
            arn,
            policyOf.has(arn) ? { exists: true, policy: policyOf.get(arn) } : { exists: false },
            ruleArn,
          );
        return targetHealth(arn, await inspectTarget(tid, arn, region), ruleArn);
      } catch {
        return "unknown";
      }
    };
    const out: NonNullable<Parts["rules"]> = [];
    for (const b of EventBuses) {
      const found = await all<{ Name: string; Arn?: string; State?: string }>(async (NextToken) => {
        const r = await callOp<{ Rules?: { Name: string; Arn?: string; State?: string }[]; NextToken?: string }>(
          tid,
          "eventbridge",
          "ListRules",
          { EventBusName: b.Name, ...(NextToken ? { NextToken } : {}) },
          region,
        );
        return { items: r.Rules ?? [], next: r.NextToken };
      });
      for (const rule of found) {
        if (!rule.Arn) continue;
        const { Targets = [] } = await callOp<{ Targets?: { Id: string; Arn: string }[] }>(
          tid,
          "eventbridge",
          "ListTargetsByRule",
          { Rule: rule.Name, EventBusName: b.Name },
          region,
        );
        const targets: NonNullable<Parts["rules"]>[number]["targets"] = [];
        for (const t of Targets) targets.push({ id: t.Id, arn: t.Arn, health: await healthOf(t.Arn, rule.Arn) });
        out.push({
          bus: b.Name,
          busArn: b.Arn,
          rule: rule.Name,
          ruleArn: rule.Arn,
          enabled: rule.State !== "DISABLED",
          targets,
        });
      }
    }
    return out;
  });

  return {
    parts: {
      topics,
      queues: queues.map(({ url, name, arn, available, inFlight, delayed, deadLetterTargetArn }) => ({
        url,
        name,
        arn,
        available,
        inFlight,
        delayed,
        ...(deadLetterTargetArn ? { deadLetterTargetArn } : {}),
      })),
      functions,
      mappings,
      rules,
    },
    warnings,
  };
}
