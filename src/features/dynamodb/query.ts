import type { AttributeDef, AttributeValue, Item, KeySchemaEl } from "./marshal";

// Turns the query builder's form state into a DynamoDB Query or Scan request. Pure, so every rule is testable.
export type IndexDesc = { IndexName: string; KeySchema: KeySchemaEl[]; Projection?: { ProjectionType?: string } };
export type TableShape = {
  KeySchema: KeySchemaEl[];
  AttributeDefinitions: AttributeDef[];
  GlobalSecondaryIndexes?: IndexDesc[];
  LocalSecondaryIndexes?: IndexDesc[];
};

export type SortOp = "=" | "<" | "<=" | ">" | ">=" | "between" | "begins_with";
export const SORT_OPS: SortOp[] = ["=", "<", "<=", ">", ">=", "between", "begins_with"];

export type FilterOp =
  "=" | "<>" | "<" | "<=" | ">" | ">=" | "begins_with" | "contains" | "not_contains" | "exists" | "not_exists";
export const FILTER_OPS: { id: FilterOp; label: string }[] = [
  { id: "=", label: "=" },
  { id: "<>", label: "≠" },
  { id: "<", label: "<" },
  { id: "<=", label: "≤" },
  { id: ">", label: ">" },
  { id: ">=", label: "≥" },
  { id: "begins_with", label: "begins with" },
  { id: "contains", label: "contains" },
  { id: "not_contains", label: "doesn't contain" },
  { id: "exists", label: "exists" },
  { id: "not_exists", label: "doesn't exist" },
];
export const needsValue = (op: FilterOp) => op !== "exists" && op !== "not_exists";

export type ValueType = "S" | "N" | "BOOL";
export type Filter = { attr: string; op: FilterOp; type: ValueType; value: string };

export type QuerySpec = {
  mode: "scan" | "query";
  index: string; // "" = the table itself
  pk: string;
  skOp: SortOp;
  sk: string;
  sk2: string; // upper bound for "between"
  filters: Filter[];
  join: "AND" | "OR";
  descending: boolean; // query only
  consistent: boolean; // not available on a global secondary index
};

export const emptySpec = (): QuerySpec => ({
  mode: "scan",
  index: "",
  pk: "",
  skOp: "=",
  sk: "",
  sk2: "",
  filters: [],
  join: "AND",
  descending: false,
  consistent: false,
});
export const emptyFilter = (): Filter => ({ attr: "", op: "=", type: "S", value: "" });

export const indexes = (s: TableShape): IndexDesc[] => [
  ...(s.GlobalSecondaryIndexes ?? []),
  ...(s.LocalSecondaryIndexes ?? []),
];
export const isGsi = (s: TableShape, name: string) =>
  (s.GlobalSecondaryIndexes ?? []).some((i) => i.IndexName === name);

export function keySchemaFor(s: TableShape, index: string): KeySchemaEl[] {
  if (!index) return s.KeySchema;
  const found = indexes(s).find((i) => i.IndexName === index);
  if (!found) throw new Error(`index “${index}” not found`);
  return found.KeySchema;
}

export const consistentAllowed = (s: TableShape, index: string) => !index || !isGsi(s, index);

const attrType = (s: TableShape, name: string) =>
  s.AttributeDefinitions.find((d) => d.AttributeName === name)?.AttributeType;

function typed(type: "S" | "N" | "B" | undefined, text: string, label: string): AttributeValue {
  if (type === "N") {
    if (text.trim() === "" || Number.isNaN(Number(text))) throw new Error(`${label}: enter a number`);
    return { N: text.trim() };
  }
  if (type === "B") return { B: text };
  return { S: text };
}

function filterValue(f: Filter): AttributeValue {
  if (f.type === "N") return typed("N", f.value, `Filter “${f.attr}”`);
  if (f.type === "BOOL") {
    if (f.value !== "true" && f.value !== "false") throw new Error(`Filter “${f.attr}”: choose true or false`);
    return { BOOL: f.value === "true" };
  }
  return { S: f.value };
}

// "a.b" addresses a nested attribute: every segment gets its own name placeholder (names may be reserved words).
function path(attr: string, i: number, names: Record<string, string>): string {
  return attr
    .split(".")
    .map((seg, j) => {
      const k = `#f${i}_${j}`;
      names[k] = seg;
      return k;
    })
    .join(".");
}

function filterExpression(
  filters: Filter[],
  join: "AND" | "OR",
  names: Record<string, string>,
  values: Record<string, AttributeValue>,
): string | undefined {
  const parts = filters.map((f, i) => {
    if (!f.attr.trim()) throw new Error(`Filter ${i + 1}: choose an attribute`);
    const p = path(f.attr.trim(), i, names);
    if (!needsValue(f.op)) return f.op === "exists" ? `attribute_exists(${p})` : `attribute_not_exists(${p})`;
    const v = `:f${i}`;
    values[v] = filterValue({ ...f, attr: f.attr.trim() });
    switch (f.op) {
      case "begins_with":
        return `begins_with(${p}, ${v})`;
      case "contains":
        return `contains(${p}, ${v})`;
      case "not_contains":
        return `NOT contains(${p}, ${v})`;
      default:
        return `${p} ${f.op} ${v}`;
    }
  });
  return parts.length ? parts.map((x) => `(${x})`).join(` ${join} `) : undefined;
}

export type Request = { operation: "Query" | "Scan"; input: Record<string, unknown> };

export function buildRequest(
  shape: TableShape,
  table: string,
  spec: QuerySpec,
  limit: number,
  startKey?: Item,
): Request {
  const ks = keySchemaFor(shape, spec.index);
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const input: Record<string, unknown> = { TableName: table, Limit: limit };
  if (spec.index) input.IndexName = spec.index;
  if (startKey) input.ExclusiveStartKey = startKey;

  const filters = spec.filters.filter((f) => f.attr.trim() || f.value !== "" || !needsValue(f.op));
  let key = "";
  if (spec.mode === "query") {
    const hash = ks.find((k) => k.KeyType === "HASH")!.AttributeName;
    const range = ks.find((k) => k.KeyType === "RANGE")?.AttributeName;
    if (spec.pk === "") throw new Error(`Enter a value for the partition key “${hash}”`);
    names["#h"] = hash;
    values[":h"] = typed(attrType(shape, hash), spec.pk, `Partition key “${hash}”`);
    key = "#h = :h";
    const hasSk = range && (spec.sk !== "" || (spec.skOp === "between" && spec.sk2 !== ""));
    if (hasSk) {
      names["#r"] = range!;
      const t = attrType(shape, range);
      values[":r"] = typed(t, spec.sk, `Sort key “${range}”`);
      if (spec.skOp === "between") {
        if (spec.sk === "" || spec.sk2 === "") throw new Error(`Sort key “${range}”: between needs both values`);
        values[":r2"] = typed(t, spec.sk2, `Sort key “${range}” (upper)`);
        key += " AND #r BETWEEN :r AND :r2";
      } else key += spec.skOp === "begins_with" ? " AND begins_with(#r, :r)" : ` AND #r ${spec.skOp} :r`;
    }
    // DynamoDB rejects a filter on a key attribute of a Query.
    const keyAttrs = new Set(ks.map((k) => k.AttributeName));
    const bad = filters.find((f) => keyAttrs.has(f.attr.trim().split(".")[0] ?? ""));
    if (bad) throw new Error(`“${bad.attr.trim()}” is a key attribute: use the key condition instead of a filter`);
    input.KeyConditionExpression = key;
    if (spec.descending) input.ScanIndexForward = false;
  }

  const fe = filterExpression(filters, spec.join, names, values);
  if (fe) input.FilterExpression = fe;
  if (Object.keys(names).length) input.ExpressionAttributeNames = names;
  if (Object.keys(values).length) input.ExpressionAttributeValues = values;
  if (spec.consistent && consistentAllowed(shape, spec.index)) input.ConsistentRead = true;
  return { operation: spec.mode === "query" ? "Query" : "Scan", input };
}

const kebab = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// The same request as an AWS CLI command, to paste into a terminal (--limit and paging are left out on purpose).
export function toCli(r: Request, endpointHint = true): string {
  const parts = [`aws dynamodb ${kebab(r.operation)}`];
  for (const [k, v] of Object.entries(r.input)) {
    if (k === "Limit" || k === "ExclusiveStartKey" || v === undefined) continue;
    if (k === "ScanIndexForward") {
      if (v === false) parts.push("--no-scan-index-forward");
      continue;
    }
    if (k === "ConsistentRead") {
      parts.push("--consistent-read");
      continue;
    }
    parts.push(`--${kebab(k)} ${typeof v === "string" ? shq(v) : shq(JSON.stringify(v))}`);
  }
  return parts.join(" \\\n  ") + (endpointHint ? "" : "");
}
