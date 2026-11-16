// DynamoDB attribute-value JSON <-> plain JSON for the item editor.
// Plain values stay plain (strings, numbers, booleans, null, lists, maps). Types that plain JSON can't express are
// tagged so an edit round-trips exactly: {"$ss": [...]} string set, {"$ns": ["1","2"]} number set, {"$b": "<base64>"}
// binary, {"$bs": [...]} binary set, {"$n": "<digits>"} a number too large or precise for a JS number.
export type AttributeValue =
  | { S: string }
  | { N: string }
  | { B: string }
  | { BOOL: boolean }
  | { NULL: boolean }
  | { SS: string[] }
  | { NS: string[] }
  | { BS: string[] }
  | { L: AttributeValue[] }
  | { M: Record<string, AttributeValue> };
export type Item = Record<string, AttributeValue>;

export function unmarshal(v: AttributeValue): unknown {
  if ("S" in v) return v.S;
  if ("BOOL" in v) return v.BOOL;
  if ("N" in v) {
    const n = Number(v.N);
    return String(n) === v.N ? n : { $n: v.N };
  }
  if ("NULL" in v) return null;
  if ("L" in v) return v.L.map(unmarshal);
  if ("M" in v) return Object.fromEntries(Object.entries(v.M).map(([k, y]) => [k, unmarshal(y)]));
  if ("SS" in v) return { $ss: v.SS };
  if ("NS" in v) return { $ns: v.NS };
  if ("B" in v) return { $b: v.B };
  if ("BS" in v) return { $bs: v.BS };
  throw new Error(`unknown attribute type ${Object.keys(v)[0]}`);
}

const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");

export function marshal(v: unknown): AttributeValue {
  if (v === null) return { NULL: true };
  if (typeof v === "string") return { S: v };
  if (typeof v === "boolean") return { BOOL: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("numbers must be finite");
    return { N: String(v) };
  }
  if (Array.isArray(v)) return { L: v.map(marshal) };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    const [k] = keys;
    if (keys.length === 1 && k !== undefined && k.startsWith("$")) {
      const x = o[k];
      switch (k) {
        case "$ss":
          if (isStringArray(x)) return { SS: x };
          break;
        case "$ns":
          if (Array.isArray(x)) return { NS: x.map((n) => String(n as string | number)) };
          break;
        case "$n":
          if (typeof x === "string" || typeof x === "number") return { N: String(x) };
          break;
        case "$b":
          if (typeof x === "string") return { B: x };
          break;
        case "$bs":
          if (isStringArray(x)) return { BS: x };
          break;
      }
      throw new Error(`invalid ${k} value`);
    }
    return { M: Object.fromEntries(keys.map((k) => [k, marshal(o[k])])) };
  }
  throw new Error(`unsupported value: ${typeof v}`);
}

export const unmarshalItem = (it: Item): Record<string, unknown> =>
  Object.fromEntries(Object.entries(it).map(([k, v]) => [k, unmarshal(v)]));
export const marshalItem = (it: Record<string, unknown>): Item =>
  Object.fromEntries(Object.entries(it).map(([k, v]) => [k, marshal(v)]));

export type KeySchemaEl = { AttributeName: string; KeyType: "HASH" | "RANGE" };
export type AttributeDef = { AttributeName: string; AttributeType: "S" | "N" | "B" };

export const keyNames = (ks: KeySchemaEl[]) => ks.map((k) => k.AttributeName);

export function itemKey(item: Record<string, unknown>, ks: KeySchemaEl[]): Item {
  return marshalItem(Object.fromEntries(keyNames(ks).map((k) => [k, item[k]])));
}

// A blank item with the key attributes pre-filled with the right type.
export function itemTemplate(ks: KeySchemaEl[], defs: AttributeDef[]): Record<string, unknown> {
  return Object.fromEntries(
    keyNames(ks).map((k) => [k, defs.find((d) => d.AttributeName === k)?.AttributeType === "N" ? 0 : ""]),
  );
}
