import { notFound } from "next/navigation";

import { PageHeader } from "@/components/common";
import { FixtureEditor } from "@/components/fixture-editor";
import type { FixtureRunView } from "@/lib/api-types";
import { query } from "@/lib/db";
import { getFixture } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function FixturePage({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const fixture = await getFixture(fid).catch(() => notFound());
  const targets = await query<{ id: string; name: string }>("select id, name from targets order by name");
  const runs = await query<FixtureRunView>(
    `select r.id, r.status, r.trigger, r.results, r.started_at, r.finished_at, t.name as target_name
     from fixture_runs r left join targets t on t.id = r.target_id
     where r.fixture_id = $1 order by r.started_at desc limit 20`,
    [fid],
  );
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <PageHeader title={fixture.name} description={`${fixture.steps.length} step(s)`} />
      <FixtureEditor
        key={fixture.id} // not updated_at: saving refreshes the page, and a remount would drop an in-flight run's result
        fixture={{ id: fixture.id, name: fixture.name, description: fixture.description, steps: fixture.steps }}
        targets={targets}
        runs={runs}
      />
    </main>
  );
}
