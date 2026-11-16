import { tryParseJson } from "@/lib/json";

export const queueNameFromUrl = (url: string) => url.split("/").pop() ?? url;
export const isFifo = (name: string) => name.endsWith(".fifo");

export function validateQueueName(name: string, fifo: boolean): string | null {
  const base = fifo && name.endsWith(".fifo") ? name.slice(0, -5) : name;
  if (!base) return "Enter a name";
  if (name.length > 80) return "Use at most 80 characters";
  if (!/^[A-Za-z0-9_-]+$/.test(base)) return "Letters, digits, hyphens and underscores only";
  return null;
}

// FIFO queues must end in ".fifo": add it for the user.
export const finalQueueName = (name: string, fifo: boolean) =>
  fifo && !name.endsWith(".fifo") ? `${name}.fifo` : name;

export type AttrRow = { name: string; type: "String" | "Number"; value: string };

export function toMessageAttributes(
  rows: AttrRow[],
): Record<string, { DataType: string; StringValue: string }> | undefined {
  const used = rows.filter((r) => r.name.trim());
  if (!used.length) return undefined;
  for (const r of used)
    if (r.type === "Number" && (r.value.trim() === "" || Number.isNaN(Number(r.value))))
      throw new Error(`Attribute “${r.name}” must be a number`);
  return Object.fromEntries(used.map((r) => [r.name.trim(), { DataType: r.type, StringValue: r.value }]));
}

export const num = (v: string | undefined) => Number(v ?? 0) || 0;

export type Counts = { available: number; inFlight: number; delayed: number };
export const counts = (a: Record<string, string> = {}): Counts => ({
  available: num(a.ApproximateNumberOfMessages),
  inFlight: num(a.ApproximateNumberOfMessagesNotVisible),
  delayed: num(a.ApproximateNumberOfMessagesDelayed),
});

// Message bodies are often JSON: show them readable, leave anything else untouched.
export function prettyBody(body: string): { text: string; json: boolean } {
  const v = tryParseJson(body);
  if (v !== null && typeof v === "object") return { text: JSON.stringify(v, null, 2), json: true };
  return { text: body, json: false };
}
