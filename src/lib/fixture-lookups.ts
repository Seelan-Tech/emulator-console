import { operations } from "./aws";
import type { Lookups } from "./fixture-check";
import { operationInput } from "./schema";

// What `checkSteps` asks the SDK, with each service's operation list read once per call.
export function sdkLookups(): Lookups {
  const ops = new Map<string, Promise<string[]>>();
  return {
    operations: (service) => {
      if (!ops.has(service)) ops.set(service, operations(service as Parameters<typeof operations>[0]));
      return ops.get(service)!;
    },
    input: (service, operation) => operationInput(service as Parameters<typeof operationInput>[0], operation),
  };
}
