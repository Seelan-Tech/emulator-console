import type { Step } from "./schemas";

export type RecordedStep = Pick<Step, "service" | "operation" | "input"> &
  Partial<Pick<Step, "region" | "delayAfterMs" | "retries" | "retryDelayMs" | "capture">> & {
    // Recorder bookkeeping, not part of a fixture: the id-shaped values this call returned (path -> value), and the
    // values of the variables this call uses (name -> value), so a link can be undone.
    produced?: Record<string, string>;
    links?: Record<string, string>;
  };

// Resources on the emulator become usable asynchronously; add the pauses/retries that make a replay reliable.
export function withTiming(s: RecordedStep): RecordedStep {
  if (s.operation === "CreateTable") return { ...s, delayAfterMs: 3000 };
  if (s.operation === "CreateFunction") return { ...s, delayAfterMs: 5000 };
  if (s.operation === "UpdateFunctionCode") return { ...s, delayAfterMs: 4000 };
  if (/^(PutItem|BatchWriteItem|UpdateItem)$/.test(s.operation)) return { ...s, retries: 5 };
  return s;
}
