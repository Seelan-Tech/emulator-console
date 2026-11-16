// Binary inputs (Lambda zips, blobs) travel as JSON in the form {"$base64": "..."}. Anything that feeds the SDK
// (the HTTP runner and fixture replay) must turn them back into Buffers first.
export function reviveBase64<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reviveBase64) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$base64" && typeof o.$base64 === "string")
      return Buffer.from(o.$base64, "base64") as T;
    return Object.fromEntries(keys.map((k) => [k, reviveBase64(o[k])])) as T;
  }
  return value;
}
