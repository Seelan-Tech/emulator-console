import { NOW, one, query } from "./db";
import { readEnv } from "./env";
import { errorInfo } from "./errors";
import { runFixtureOnTarget, waitForEmulator } from "./fixture-runs";
import { ensureLocalTarget } from "./local-target";
import { log } from "./log";
import type { FixtureRow } from "./repo";
import { observe, shouldAutoReplay } from "./restart";
import { emulatorFingerprint, type TargetRow } from "./targets";

const replaying = new Set<string>(); // single-flight per target within this process

// Compares the emulator instance we last saw with the one running now. The update is conditional on the old
// fingerprint, so with several app instances exactly one of them observes (and reacts to) a given restart.
export async function checkRestart(target: TargetRow): Promise<TargetRow> {
  const current = emulatorFingerprint(target);
  const seen = observe(target.instance_fingerprint, current);
  if (seen === "first") {
    await query("update targets set instance_fingerprint = $2 where id = $1 and instance_fingerprint is null", [
      target.id,
      current,
    ]);
    return { ...target, instance_fingerprint: current };
  }
  if (seen !== "restarted") return target;
  const row = await one<TargetRow>(
    `update targets set instance_fingerprint = $2, restarted_at = ${NOW}, restart_acknowledged_at = null where id = $1 and instance_fingerprint = $3 returning *`,
    [target.id, current, target.instance_fingerprint],
  );
  if (!row) return (await one<TargetRow>("select * from targets where id = $1", [target.id])) ?? target; // another instance won
  log.info("emulator restarted", { target: row.name });
  if (shouldAutoReplay({ autoReplay: row.auto_replay, baselineFixtureId: row.baseline_fixture_id }))
    void autoReplay(row);
  return row;
}

async function autoReplay(target: TargetRow) {
  if (replaying.has(target.id)) return;
  replaying.add(target.id);
  try {
    const fixture = await one<FixtureRow>("select * from fixtures where id = $1", [target.baseline_fixture_id]);
    if (!fixture) return;
    if (!(await waitForEmulator(target))) {
      log.error("emulator did not come back within 60 s; baseline not replayed", { target: target.name });
      return;
    }
    const run = await runFixtureOnTarget({ fixture, target, trigger: "restart" });
    log.info("baseline fixture replayed after restart", {
      fixture: fixture.name,
      target: target.name,
      status: run.status,
    });
  } catch (e) {
    log.error("automatic replay failed", { error: errorInfo(e).message });
  } finally {
    replaying.delete(target.id);
  }
}

const g = globalThis as unknown as { __restartTimer?: NodeJS.Timeout };

// Watches every files-mode target so a restart is noticed (and the baseline replayed) even when nobody has the UI open.
export function startRestartWatcher(intervalMs = 5000) {
  if (!readEnv().ALLOW_LOCAL_CREDENTIAL_FILES || g.__restartTimer) return;
  const tick = async () => {
    try {
      await ensureLocalTarget();
      const targets = await query<TargetRow>("select * from targets where auth_mode = 'files'");
      for (const t of targets) await checkRestart(t);
    } catch (e) {
      log.error("restart watcher failed", { error: errorInfo(e).message });
    }
  };
  g.__restartTimer = setInterval(() => void tick(), intervalMs);
  g.__restartTimer.unref();
  setTimeout(() => void tick(), 3000).unref();
  log.info("watching for emulator restarts", { everySeconds: intervalMs / 1000 });
}
