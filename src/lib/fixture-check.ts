import { referencedVars, VAR_REF } from "./fixture-vars";
import { isMutating } from "./mutating";
import type { Field } from "./schema";
import { type Step, step as stepSchema } from "./schemas";

// A check of a fixture without calling the emulator: it reads the steps against what the SDK knows about each
// operation, and against each other. Pure: the lookups are passed in, so it runs without the SDK in tests.
export type Problem = { step: number; level: "error" | "warning"; message: string };
export type Lookups = {
  operations: (service: string) => Promise<string[]>;
  input: (service: string, operation: string) => Promise<Field | null>;
};

// Operations whose call has an effect outside the emulator's resource state: a replay does it again.
const SENDS = /^(SendMessage|SendMessageBatch|Publish|PublishBatch|PutEvents|PutRecord|PutRecords|StartExecution)$/;

const hasPlaceholder = (v: unknown) => typeof v === "string" && new RegExp(VAR_REF.source).test(v);
const describe = (v: unknown) =>
  Array.isArray(v) ? "a list" : v === null ? "null" : typeof v === "object" ? "an object" : `a ${typeof v}`;

// Walks a value against its field. Required members are errors; a value of the wrong kind is an error where the
// SDK would reject it, and unknown members are warnings (the SDK ignores them, which usually means a typo).
function checkValue(value: unknown, field: Field, path: string, out: string[], warn: string[]) {
  if (hasPlaceholder(value)) return; // only known at replay
  switch (field.kind) {
    case "struct": {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return void out.push(`${path} should be an object, not ${describe(value)}`);
      const o = value as Record<string, unknown>;
      for (const f of field.fields) {
        const sub = path ? `${path}.${f.name}` : f.name;
        if (o[f.name] === undefined) {
          if (f.required) out.push(`${sub} is required`);
        } else checkValue(o[f.name], f.field, sub, out, warn);
      }
      const known = new Set(field.fields.map((f) => f.name));
      for (const k of Object.keys(o))
        if (!known.has(k)) warn.push(`${path ? `${path}.` : ""}${k} is not a field of this operation (it is ignored)`);
      return;
    }
    case "list":
      if (!Array.isArray(value)) return void out.push(`${path} should be a list, not ${describe(value)}`);
      value.forEach((v, i) => checkValue(v, field.item, `${path}[${i}]`, out, warn));
      return;
    case "map":
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return void out.push(`${path} should be an object, not ${describe(value)}`);
      for (const [k, v] of Object.entries(value)) checkValue(v, field.value, `${path}.${k}`, out, warn);
      return;
    case "string":
      if (typeof value !== "string") out.push(`${path} should be a string, not ${describe(value)}`);
      return;
    case "boolean":
      if (typeof value !== "boolean") out.push(`${path} should be true or false, not ${describe(value)}`);
      return;
    case "number":
      if (typeof value !== "number") out.push(`${path} should be a number, not ${describe(value)}`);
      return;
    default:
      return; // blobs, timestamps and free JSON take several shapes
  }
}

// A create followed by a delete of the same thing: every field the delete names has the same value in the create.
function undoes(create: Step, del: Step): boolean {
  const c = /^Create(.+)$/.exec(create.operation)?.[1];
  const d = /^Delete(.+)$/.exec(del.operation)?.[1];
  if (!c || c !== d || create.service !== del.service) return false;
  const keys = Object.keys(del.input);
  return keys.length > 0 && keys.every((k) => JSON.stringify(create.input[k]) === JSON.stringify(del.input[k]));
}

export async function checkSteps(raw: unknown[], look: Lookups): Promise<Problem[]> {
  const problems: Problem[] = [];
  const add = (step: number, level: Problem["level"], message: string) => problems.push({ step, level, message });
  const steps: (Step | null)[] = raw.map((r, i) => {
    const p = stepSchema.safeParse(r);
    if (!p.success) {
      for (const issue of p.error.issues) add(i, "error", `${issue.path.join(".") || "step"}: ${issue.message}`);
      return null;
    }
    return p.data;
  });

  const known = new Map<string, Set<string>>();
  const captured = new Map<string, number>(); // variable -> the step that captures it (the first one)
  for (const [i, s] of steps.entries()) {
    if (!s) continue;
    if (!known.has(s.service)) known.set(s.service, new Set(await look.operations(s.service)));
    if (!known.get(s.service)!.has(s.operation)) {
      add(i, "error", `${s.service} has no operation ${s.operation}`);
    } else {
      const field = await look.input(s.service, s.operation);
      if (field) {
        const errors: string[] = [];
        const warnings: string[] = [];
        checkValue(s.input, field, "", errors, warnings);
        for (const m of errors) add(i, "error", m.replace(/^\./, ""));
        for (const m of warnings) add(i, "warning", m);
      }
    }

    for (const name of referencedVars([s.input, s.expect])) {
      const from = captured.get(name);
      if (from !== undefined) continue;
      const later = steps.findIndex((t, j) => j > i && t?.capture && name in t.capture);
      add(
        i,
        "error",
        later >= 0
          ? `uses {{${name}}}, which step ${later + 1} captures later`
          : `uses {{${name}}}, which no step captures`,
      );
    }
    for (const name of Object.keys(s.capture ?? {})) if (!captured.has(name)) captured.set(name, i);

    if (s.expect && isMutating(s.operation))
      add(i, "warning", `${s.operation} changes state, and a failed check runs it again: check with a read instead`);
    if (SENDS.test(s.operation)) add(i, "warning", `${s.operation} sends again on every replay`);
    for (let j = 0; j < i; j++) {
      const earlier = steps[j];
      if (earlier && undoes(earlier, s))
        add(i, "warning", `undoes step ${j + 1} (${earlier.operation}): both run on every replay`);
    }
  }
  return problems;
}
