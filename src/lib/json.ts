// JSON.parse that reports failure as `undefined` instead of throwing: for text that is only sometimes JSON
// (message bodies, secret values) where "not JSON" is a normal outcome.
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
