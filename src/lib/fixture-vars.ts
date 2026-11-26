// Variables for fixtures: a step captures values from its response (`capture`), and later steps use them as
// `{{name}}` inside any string of their input. Pure, so the replay engine, the editor and the CLI export share it.

export const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A path into a response: Attributes.QueueArn, Subnets[0].SubnetId. Also valid as a JMESPath for `aws --query`.
export const VAR_PATH = /^[A-Za-z0-9_]+(\[\d+\])*(\.[A-Za-z0-9_]+(\[\d+\])*)*$/;

export const VAR_REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

export type Vars = Record<string, unknown>;

export function getPath(value: unknown, path: string): unknown {
  let cur = value;
  for (const part of path.match(/[A-Za-z0-9_]+|\[\d+\]/g) ?? []) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = part.startsWith("[") ? (cur as unknown[])[Number(part.slice(1, -1))] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// The names a value refers to, in order of first use.
export function referencedVars(value: unknown, into = new Set<string>()): string[] {
  if (typeof value === "string") for (const m of value.matchAll(VAR_REF)) into.add(m[1]!);
  else if (Array.isArray(value)) for (const v of value) referencedVars(v, into);
  else if (value && typeof value === "object") for (const v of Object.values(value)) referencedVars(v, into);
  return [...into];
}

const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

// A string that is exactly {{name}} becomes the captured value itself (keeping its type); a placeholder inside
// longer text is replaced by the value as text. Names that are not set stay as they are and are listed in `missing`.
export function substitute(value: unknown, vars: Vars): { value: unknown; missing: string[] } {
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = WHOLE.exec(v);
      if (whole) {
        if (whole[1]! in vars) return vars[whole[1]!];
        missing.add(whole[1]!);
        return v;
      }
      return v.replace(VAR_REF, (m, name: string) => {
        if (name in vars) return text(vars[name]);
        missing.add(name);
        return m;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), missing: [...missing] };
}
