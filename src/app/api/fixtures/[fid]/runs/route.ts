import { query } from "@/lib/db";
import { json, route } from "@/lib/http";
import { getFixture } from "@/lib/repo";

export const GET = route<{ fid: string }>(async (_req, { fid }) => {
  await getFixture(fid);
  return json(
    await query(
      `select r.id, r.status, r.trigger, r.results, r.started_at, r.finished_at, t.name as target_name
       from fixture_runs r left join targets t on t.id = r.target_id
       where r.fixture_id = $1 order by r.started_at desc limit 20`,
      [fid],
    ),
  );
});
