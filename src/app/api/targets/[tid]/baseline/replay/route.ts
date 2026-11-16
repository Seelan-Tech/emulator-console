import { NOW, one } from "@/lib/db";
import { runFixtureOnTarget } from "@/lib/fixture-runs";
import { HttpError, json, route } from "@/lib/http";
import type { FixtureRow } from "@/lib/repo";
import { getTarget } from "@/lib/targets";

export const maxDuration = 300;

// Replays the target's baseline fixture (restores state after an emulator restart) and dismisses the banner.
export const POST = route<{ tid: string }>(async (_req, { tid }) => {
  const target = await getTarget(tid);
  if (!target.baseline_fixture_id) throw new HttpError(400, "this target has no baseline fixture");
  const fixture = await one<FixtureRow>("select * from fixtures where id = $1", [target.baseline_fixture_id]);
  if (!fixture) throw new HttpError(404, "baseline fixture not found");
  const run = await runFixtureOnTarget({ fixture, target, trigger: "manual" });
  await one(`update targets set restart_acknowledged_at = ${NOW} where id = $1`, [tid]);
  return json(run);
});
