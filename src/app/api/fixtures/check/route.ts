import { z } from "zod";

import { operations } from "@/lib/aws";
import { checkSteps } from "@/lib/fixture-check";
import { body, json, route } from "@/lib/http";
import { operationInput } from "@/lib/schema";

// Checks steps without calling the emulator, so it takes the steps as typed in the editor (saved or not).
export const POST = route(async (req) => {
  const { steps } = await body(req, z.object({ steps: z.array(z.unknown()).max(500) }));
  const ops = new Map<string, Promise<string[]>>();
  const problems = await checkSteps(steps, {
    operations: (service) => {
      if (!ops.has(service)) ops.set(service, operations(service as Parameters<typeof operations>[0]));
      return ops.get(service)!;
    },
    input: (service, operation) => operationInput(service as Parameters<typeof operationInput>[0], operation),
  });
  return json({ problems });
});
