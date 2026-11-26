import { isDeepStrictEqual } from "node:util";

import { getPath } from "./fixture-vars";
import type { Expectation } from "./schemas";

// Assertions on a step's response (`expect`). Pure: the replay engine, the check and the tests share it.

// Services whose responses can hold secret values: a failure there never quotes what the response held.
const HIDDEN = new Set(["secretsmanager", "ssm", "kms"]);
const SHOW = 120;

const clip = (s: string) => (s.length > SHOW ? `${s.slice(0, SHOW)}…` : s);
const show = (v: unknown) => (v === undefined ? "nothing" : clip(JSON.stringify(v) ?? "nothing"));

// Comparisons accept a number that came back as text (SQS attributes are all strings).
const asNumber = (v: unknown) =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;

const sizeOf = (v: unknown) =>
  typeof v === "string" || Array.isArray(v)
    ? v.length
    : v !== null && typeof v === "object"
      ? Object.keys(v).length
      : undefined;

const present = (v: unknown) => v !== undefined && v !== null;

function judge(e: Expectation, actual: unknown): { ok: boolean; wanted: string } {
  if (Object.hasOwn(e, "equals")) return { ok: isDeepStrictEqual(actual, e.equals), wanted: show(e.equals) };
  if (Object.hasOwn(e, "notEquals"))
    return { ok: !isDeepStrictEqual(actual, e.notEquals), wanted: `anything but ${show(e.notEquals)}` };
  if (Object.hasOwn(e, "contains")) {
    const ok =
      typeof actual === "string"
        ? typeof e.contains === "string" && actual.includes(e.contains)
        : Array.isArray(actual) && actual.some((x) => isDeepStrictEqual(x, e.contains));
    return { ok, wanted: `to contain ${show(e.contains)}` };
  }
  if (e.exists !== undefined) return { ok: present(actual) === e.exists, wanted: e.exists ? "a value" : "no value" };
  if (e.length !== undefined) return { ok: sizeOf(actual) === e.length, wanted: `a length of ${e.length}` };
  if (e.matches !== undefined) {
    const text = typeof actual === "string" || typeof actual === "number" ? String(actual) : undefined;
    return { ok: text !== undefined && new RegExp(e.matches).test(text), wanted: `to match /${e.matches}/` };
  }
  const n = asNumber(actual);
  if (e.gt !== undefined) return { ok: n > e.gt, wanted: `more than ${e.gt}` };
  if (e.gte !== undefined) return { ok: n >= e.gte, wanted: `${e.gte} or more` };
  if (e.lt !== undefined) return { ok: n < e.lt, wanted: `less than ${e.lt}` };
  return { ok: n <= e.lte!, wanted: `${e.lte} or less` };
}

// The failures, one line each; empty when every check holds.
export function evaluateExpect(list: Expectation[], output: unknown, service: string): string[] {
  const hide = HIDDEN.has(service);
  const failures: string[] = [];
  for (const e of list) {
    const actual = getPath(output, e.path);
    const { ok, wanted } = judge(e, actual);
    if (!ok) failures.push(`${e.path}: expected ${wanted}, got ${hide ? "a value that is not shown" : show(actual)}`);
  }
  return failures;
}
