import { one } from "@/lib/db";
import { json, route } from "@/lib/http";
import { bannerVisible } from "@/lib/restart";
import { checkRestart } from "@/lib/restart-watch";
import { emulatorVersion, getTarget, localFilesEnabled } from "@/lib/targets";

export const dynamic = "force-dynamic";

// Polled by the UI: restart state, the baseline, and the latest fixture run on this target. Checking here also
// notices a restart immediately instead of waiting for the background watcher's next tick.
export const GET = route<{ tid: string }>(async (_req, { tid }) => {
  const t = await checkRestart(await getTarget(tid));
  const baseline = t.baseline_fixture_id
    ? await one<{ id: string; name: string }>("select id, name from fixtures where id = $1", [t.baseline_fixture_id])
    : null;
  const last = await one<{
    id: string;
    status: string;
    trigger: string;
    started_at: string;
    finished_at: string | null;
    results: { ok: boolean; index: number; operation: string; error?: string }[];
    fixture_name: string;
  }>(
    `select r.id, r.status, r.trigger, r.started_at, r.finished_at, r.results, f.name as fixture_name
     from fixture_runs r join fixtures f on f.id = r.fixture_id where r.target_id = $1 order by r.started_at desc limit 1`,
    [tid],
  );
  const failed = last?.results.find((r) => !r.ok);
  return json({
    canDetect: t.auth_mode === "files" && localFilesEnabled(),
    emulator: emulatorVersion(t),
    restartedAt: t.restarted_at,
    bannerVisible: bannerVisible({ restartedAt: t.restarted_at, acknowledgedAt: t.restart_acknowledged_at }),
    baseline,
    autoReplay: t.auto_replay,
    lastRun: last && {
      id: last.id,
      status: last.status,
      trigger: last.trigger,
      startedAt: last.started_at,
      fixtureName: last.fixture_name,
      steps: last.results.length,
      failedStep: failed ? { index: failed.index + 1, operation: failed.operation, error: failed.error } : null,
    },
  });
});
