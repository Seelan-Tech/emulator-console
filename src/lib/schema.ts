import { NormalizedSchema } from "@smithy/core/schema";

import { loadService, type ServiceName } from "./aws";

// Operation input shapes, decoded from the Smithy schemas that every AWS SDK v3 client ships at runtime and
// reduced to a small JSON tree the browser can render as a form. Anything that can't be modelled becomes a
// "document" (free JSON), so the form degrades gracefully instead of failing.
export type Field =
  | { kind: "string" | "number" | "boolean" | "timestamp" | "document" }
  | { kind: "blob"; streaming: boolean }
  | { kind: "list"; item: Field }
  | { kind: "map"; value: Field }
  | { kind: "struct"; fields: FieldDef[] };

export type FieldDef = { name: string; required: boolean; field: Field };

const MAX_DEPTH = 6;

function convert(ns: NormalizedSchema, path: string[]): Field {
  if (ns.isStructSchema()) {
    const id = ns.getName(true) ?? "";
    // Recursive shapes (e.g. DynamoDB's AttributeValue) and very deep ones fall back to free JSON.
    if (path.includes(id) || path.length >= MAX_DEPTH) return { kind: "document" };
    const raw = ns.getSchema() as unknown[];
    const requiredCount = typeof raw[6] === "number" ? raw[6] : 0; // members are ordered with the required ones first
    const fields: FieldDef[] = [];
    let i = 0;
    for (const [name, member] of ns.structIterator()) {
      fields.push({ name, required: i++ < requiredCount, field: convert(member, [...path, id]) });
    }
    return { kind: "struct", fields };
  }
  if (ns.isListSchema()) return { kind: "list", item: convert(ns.getValueSchema(), path) };
  if (ns.isMapSchema()) return { kind: "map", value: convert(ns.getValueSchema(), path) };
  if (ns.isStringSchema()) return { kind: "string" };
  if (ns.isBooleanSchema()) return { kind: "boolean" };
  if (ns.isNumericSchema() || ns.isBigIntegerSchema() || ns.isBigDecimalSchema()) return { kind: "number" };
  if (ns.isTimestampSchema()) return { kind: "timestamp" };
  if (ns.isBlobSchema()) return { kind: "blob", streaming: ns.isStreaming() };
  return { kind: "document" };
}

// The pure part, so it can be tested against any schema reference.
export function inputField(operationSchema: unknown): Field | null {
  try {
    const op = operationSchema as unknown[];
    const input = typeof op?.[4] === "function" ? (op[4] as () => unknown)() : op?.[4];
    if (!input) return null;
    return convert(NormalizedSchema.of(input as never), []);
  } catch {
    return null;
  }
}

const cache = new Map<string, Field | null>();

export async function operationInput(service: ServiceName, operation: string): Promise<Field | null> {
  const key = `${service}:${operation}`;
  if (cache.has(key)) return cache.get(key)!;
  const mod = await loadService(service);
  const field = mod[`${operation}$`] ? inputField(mod[`${operation}$`]) : null;
  cache.set(key, field);
  return field;
}
