import { tryParseJson } from "@/lib/json";

export const secretHref = (base: string, name: string) => `${base}/secrets/detail?name=${encodeURIComponent(name)}`;

// Secret values are often JSON: show them readable, leave anything else untouched.
export function prettySecret(value: string): { text: string; json: boolean } {
  const v = tryParseJson(value);
  if (v !== null && typeof v === "object") return { text: JSON.stringify(v, null, 2), json: true };
  return { text: value, json: false };
}

export function validateSecretName(name: string): string | null {
  if (!name) return "Enter a name";
  if (name.length > 512) return "Use at most 512 characters";
  if (!/^[A-Za-z0-9/_+=.@-]+$/.test(name)) return "Letters, digits and / _ + = . @ - only";
  return null;
}

export const mask = (s: string) => "•".repeat(Math.min(Math.max(s.length, 8), 24));
