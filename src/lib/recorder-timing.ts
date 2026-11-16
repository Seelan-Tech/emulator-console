import type { Step } from "./schemas";

export type RecordedStep = Pick<Step, "service" | "operation" | "input"> &
  Partial<Pick<Step, "region" | "delayAfterMs" | "retries" | "retryDelayMs">>;

// Resources on the emulator become usable asynchronously; add the pauses/retries that make a replay reliable.
export function withTiming(s: RecordedStep): RecordedStep {
  if (s.operation === "CreateTable") return { ...s, delayAfterMs: 3000 };
  if (s.operation === "CreateFunction") return { ...s, delayAfterMs: 5000 };
  if (s.operation === "UpdateFunctionCode") return { ...s, delayAfterMs: 4000 };
  if (/^(PutItem|BatchWriteItem|UpdateItem)$/.test(s.operation)) return { ...s, retries: 5 };
  return s;
}
