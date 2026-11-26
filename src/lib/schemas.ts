import { z } from "zod";

import { serviceNames } from "./aws";
import { VAR_NAME, VAR_PATH } from "./fixture-vars";

const pem = z
  .string()
  .trim()
  .max(20_000)
  .refine((s) => s.includes("BEGIN CERTIFICATE"), "must be a PEM certificate");

export const targetCreate = z
  .object({
    name: z.string().trim().min(1).max(80),
    endpointUrl: z.string().trim().url().max(500),
    region: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "e.g. us-east-1")
      .default("us-east-1"),
    tlsServername: z.string().trim().max(253).optional(),
    caPem: pem.optional(),
    authMode: z.enum(["static", "files"]),
    accessKeyId: z.string().trim().min(1).max(128).optional(),
    secretAccessKey: z.string().min(1).max(256).optional(),
    filesDir: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.authMode === "static") {
      if (!t.accessKeyId) ctx.addIssue({ code: "custom", path: ["accessKeyId"], message: "required" });
      if (!t.secretAccessKey) ctx.addIssue({ code: "custom", path: ["secretAccessKey"], message: "required" });
    } else if (!t.filesDir) ctx.addIssue({ code: "custom", path: ["filesDir"], message: "required" });
  });

export const targetUpdate = z
  .object({
    name: z.string().trim().min(1).max(80),
    endpointUrl: z.string().trim().url().max(500),
    region: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
    tlsServername: z.string().trim().max(253).nullable(),
    caPem: pem.nullable(),
    accessKeyId: z.string().trim().min(1).max(128),
    secretAccessKey: z.string().min(1).max(256),
    filesDir: z.string().trim().min(1).max(500),
    baselineFixtureId: z.string().uuid().nullable(),
    autoReplay: z.boolean(),
  })
  .partial();

// A check on a step's response: a path and exactly one matcher. `exists: false` means the path has no value.
const MATCHERS = ["equals", "notEquals", "contains", "exists", "length", "gt", "gte", "lt", "lte", "matches"] as const;
export const expectation = z
  .object({
    path: z.string().regex(VAR_PATH).max(200),
    equals: z.unknown().optional(),
    notEquals: z.unknown().optional(),
    contains: z.unknown().optional(),
    exists: z.boolean().optional(),
    length: z.number().int().min(0).optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    matches: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const given = MATCHERS.filter((m) => Object.hasOwn(e, m));
    if (given.length !== 1)
      ctx.addIssue({ code: "custom", message: `give exactly one of ${MATCHERS.join(", ")} (found ${given.length})` });
    if (e.matches !== undefined) {
      try {
        new RegExp(e.matches);
      } catch {
        ctx.addIssue({ code: "custom", path: ["matches"], message: "is not a valid regular expression" });
      }
    }
  });
export type Expectation = z.infer<typeof expectation>;

export const step = z.object({
  service: z.enum(serviceNames),
  operation: z.string().regex(/^[A-Za-z0-9]{1,100}$/),
  input: z.record(z.string(), z.unknown()).default({}),
  region: z.string().optional(),
  delayAfterMs: z.number().int().min(0).max(60_000).default(0),
  retries: z.number().int().min(0).max(20).default(0),
  retryDelayMs: z.number().int().min(100).max(30_000).default(1000),
  // Values to keep from the response for later steps: { variableName: "Path.In.Response" }.
  capture: z.record(z.string().regex(VAR_NAME).max(60), z.string().regex(VAR_PATH).max(200)).optional(),
  // An assertion: checks on the response. A step that fails them is retried like any failed step (`retries`).
  expect: z.array(expectation).min(1).max(20).optional(),
});
export type Step = z.infer<typeof step>;

export const steps = z.array(step).max(500);

export const fixtureCreate = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  steps: steps.default([]),
});
// No defaults here: a partial update must leave the fields it does not mention alone.
export const fixtureUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500),
    steps,
  })
  .partial();

export const runRequest = z.object({
  targetId: z.string().uuid(),
  continueOnError: z.boolean().default(false),
  // Resume a failed run: the first step to run (0-based). Earlier steps are skipped, except those that capture a
  // value a later step needs.
  fromStep: z.number().int().min(0).max(499).optional(),
});
