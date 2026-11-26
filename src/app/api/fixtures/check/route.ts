import { z } from "zod";

import { checkSteps } from "@/lib/fixture-check";
import { sdkLookups } from "@/lib/fixture-lookups";
import { body, json, route } from "@/lib/http";

// Checks steps without calling the emulator, so it takes the steps as typed in the editor (saved or not).
export const POST = route(async (req) => {
  const { steps } = await body(req, z.object({ steps: z.array(z.unknown()).max(500) }));
  return json({ problems: await checkSteps(steps, sdkLookups()) });
});
