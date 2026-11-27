import { arnName, type EndpointState, type Health, policyAllowsSource } from "../sns/logic";

// The pure part of the EventBridge screen: names, patterns, schedules, targets and the permissions a target needs.

export const EVENTS_SERVICE = "events.amazonaws.com";
const NAME = /^[A-Za-z0-9._-]+$/;

export function validateBusName(name: string): string | null {
  if (!name.trim()) return "Enter a name";
  if (name.length > 256) return "Use at most 256 characters";
  if (!NAME.test(name)) return "Letters, digits, dots, hyphens and underscores only";
  if (name.toLowerCase() === "default") return "The default bus exists already";
  return null;
}

export function validateRuleName(name: string): string | null {
  if (!name.trim()) return "Enter a name";
  if (name.length > 64) return "Use at most 64 characters";
  if (!NAME.test(name)) return "Letters, digits, dots, hyphens and underscores only";
  return null;
}

// An event pattern is a JSON object. Returns what is wrong with the text, or null.
export function validatePattern(text: string): string | null {
  if (!text.trim()) return "Enter an event pattern";
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return `Not valid JSON: ${(e as Error).message}`;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return "An event pattern is a JSON object";
  if (Object.keys(v).length === 0) return "An empty pattern matches nothing useful: name at least one field";
  return null;
}

// rate(5 minutes), rate(1 hour), cron(0 12 * * ? *). AWS wants the singular unit for 1 and the plural otherwise.
export function validateSchedule(expr: string): string | null {
  const e = expr.trim();
  if (!e) return "Enter a schedule";
  const rate = /^rate\((\d+) (minute|minutes|hour|hours|day|days)\)$/.exec(e);
  if (rate) {
    const n = Number(rate[1]);
    const plural = rate[2]!.endsWith("s");
    if (n < 1) return "The rate must be at least 1";
    if (n === 1 && plural) return "Use the singular for 1: rate(1 minute)";
    if (n > 1 && !plural) return `Use the plural for ${n}: rate(${n} ${rate[2]}s)`;
    return null;
  }
  if (/^cron\(.+\)$/.test(e))
    return e.slice(5, -1).trim().split(/\s+/).length === 6 ? null : "A cron expression has six fields";
  return "Use rate(5 minutes) or cron(0 12 * * ? *)";
}

export type RuleLike = { EventPattern?: string; ScheduleExpression?: string };

// What fires a rule, for a table cell: the pattern on one line, or the schedule.
export function ruleTrigger(r: RuleLike): { kind: "pattern" | "schedule" | "none"; text: string } {
  if (r.ScheduleExpression) return { kind: "schedule", text: r.ScheduleExpression };
  if (r.EventPattern) {
    try {
      return { kind: "pattern", text: JSON.stringify(JSON.parse(r.EventPattern)) };
    } catch {
      return { kind: "pattern", text: r.EventPattern };
    }
  }
  return { kind: "none", text: "" };
}

export const PATTERN_TEMPLATES: { label: string; pattern: object }[] = [
  { label: "Any event from a source", pattern: { source: ["my.app"] } },
  { label: "A source and a detail type", pattern: { source: ["my.app"], "detail-type": ["order.created"] } },
  { label: "A value inside the detail", pattern: { source: ["my.app"], detail: { status: ["failed"] } } },
  { label: "Any event with a field", pattern: { detail: { orderId: [{ exists: true }] } } },
];

// An event the way EventBridge hands it to a rule: the envelope around what was put. Filled from the pattern where it
// names plain values, so the tester starts from something that nearly matches.
export function sampleEvent(pattern?: string): string {
  let source = "my.app";
  let detailType = "order.created";
  let detail: unknown = {};
  try {
    const p = JSON.parse(pattern ?? "null") as Record<string, unknown> | null;
    const first = (v: unknown) => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);
    source = first(p?.source) ?? source;
    detailType = first(p?.["detail-type"]) ?? detailType;
    if (p?.detail && typeof p.detail === "object") {
      const d: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p.detail as Record<string, unknown>)) {
        const f = first(v);
        if (f !== undefined) d[k] = f;
      }
      detail = d;
    }
  } catch {
    // no usable pattern: the defaults stand
  }
  return JSON.stringify(
    {
      version: "0",
      id: "11111111-2222-3333-4444-555555555555",
      "detail-type": detailType,
      source,
      account: "000000000000",
      time: "2026-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      detail,
    },
    null,
    2,
  );
}

// The text of an event put from the console: a JSON object (or nothing, which is {}).
export function validateDetail(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? null : "The detail is a JSON object";
  } catch (e) {
    return `Not valid JSON: ${(e as Error).message}`;
  }
}

// ---- targets ----------------------------------------------------------------------------------------------------

export type TargetKind = "sqs" | "lambda" | "sns" | "other";
export const targetKind = (arn: string): TargetKind => {
  const svc = arn.split(":")[2];
  return svc === "sqs" || svc === "lambda" || svc === "sns" ? svc : "other";
};

// Only these three are checked: the emulator delivers to them only if their policy allows the rule.
const ACTION: Record<Exclude<TargetKind, "other">, string> = {
  sqs: "sqs:SendMessage",
  lambda: "lambda:InvokeFunction",
  sns: "sns:Publish",
};

export function targetHealth(arn: string, state: EndpointState, ruleArn: string): Health | "not-checked" {
  const kind = targetKind(arn);
  if (kind === "other") return "not-checked";
  if (!state.exists) return "missing";
  return policyAllowsSource(state.policy, EVENTS_SERVICE, ruleArn, ACTION[kind]) ? "delivers" : "needs-permission";
}

// A target id: up to 64 letters, digits, dots, hyphens and underscores.
export const targetId = (arn: string) => (arnName(arn).replace(/[^A-Za-z0-9._-]/g, "-") || "target").slice(0, 64);

// A statement id: also used as the Sid of a policy statement. One per rule, so a rule's permission can be found again.
export const ruleStatementId = (bus: string, rule: string) =>
  `events-${bus}-${rule}`.replace(/[^\w-]/g, "-").slice(0, 100);

type Statement = { Sid?: string; [k: string]: unknown };
type Policy = { Version?: string; Statement?: Statement[] };

// Adds (or replaces) the statement that lets a rule use a queue or topic, and keeps the rest of the policy.
export function addRuleToPolicy(
  existing: string | undefined,
  o: { resourceArn: string; ruleArn: string; bus: string; rule: string; action: "sqs:SendMessage" | "sns:Publish" },
): string {
  const policy: Policy = existing ? (JSON.parse(existing) as Policy) : { Version: "2012-10-17", Statement: [] };
  const Sid = ruleStatementId(o.bus, o.rule);
  const statements = (policy.Statement ?? []).filter((s) => s.Sid !== Sid);
  statements.push({
    Sid,
    Effect: "Allow",
    Principal: { Service: EVENTS_SERVICE },
    Action: o.action,
    Resource: o.resourceArn,
    Condition: { ArnEquals: { "aws:SourceArn": o.ruleArn } },
  });
  return JSON.stringify({ ...policy, Statement: statements });
}

// Where a target's own screen is, for a link. Functions are named after "function:" and may carry an alias.
export function targetHref(base: string, arn: string): string | null {
  const name = arnName(arn);
  switch (targetKind(arn)) {
    case "sqs":
      return `${base}/sqs/${encodeURIComponent(name)}`;
    case "sns":
      return `${base}/sns/${encodeURIComponent(name)}`;
    case "lambda":
      return `${base}/lambda/${encodeURIComponent(arn.split(":")[6] ?? name)}`;
    default:
      return null;
  }
}
