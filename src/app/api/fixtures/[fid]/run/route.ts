import { runFixtureOnTarget } from "@/lib/fixture-runs";
import { body, json, route } from "@/lib/http";
import { getFixture } from "@/lib/repo";
import { runRequest } from "@/lib/schemas";
import { getTarget } from "@/lib/targets";

export const maxDuration = 300;

// Runs synchronously and records the run. For long fixtures or many users, move this to a worker that
// claims `running` rows with `for update skip locked` (see README, "Scaling").
export const POST = route<{ fid: string }>(async (req, { fid }) => {
  const fixture = await getFixture(fid);
  const { targetId, continueOnError } = await body(req, runRequest);
  const target = await getTarget(targetId);
  return json(await runFixtureOnTarget({ fixture, target, trigger: "manual", continueOnError }));
});
