// JSON.parse that reports failure as `undefined` instead of throwing: for text that is only sometimes JSON
// (message bodies, secret values) where "not JSON" is a normal outcome.
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// The text re-indented, when it is a JSON object or array; `undefined` for anything else (scalars are left as typed).
export function beautifyJson(text: string): string | undefined {
  const v = tryParseJson(text);
  return v !== null && typeof v === "object" ? JSON.stringify(v, null, 2) : undefined;
}
