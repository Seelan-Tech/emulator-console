import { createHash } from "node:crypto";

// Pure parts of restart detection (the database and emulator I/O live in restart-watch.ts).
// The emulator regenerates its access keys on every start, so for a target that reads the emulator's own
// credential files, a hash of the access key id identifies the running instance.
export const fingerprint = (accessKeyId: string) => createHash("sha256").update(accessKeyId).digest("hex").slice(0, 16);

export type Observation = "unknown" | "first" | "same" | "restarted";

// stored: what we last recorded. current: what we see now (null when it can't be read, e.g. mid-restart).
export function observe(stored: string | null, current: string | null): Observation {
  if (current === null) return "unknown";
  if (stored === null) return "first"; // first sighting: remember it, nothing was lost
  return stored === current ? "same" : "restarted";
}

export type RestartState = {
  restartedAt: string | null;
  acknowledgedAt: string | null;
  baselineFixtureId: string | null;
  autoReplay: boolean;
};

// The banner shows from the moment a restart is seen until someone dismisses it (or a new restart happens).
export function bannerVisible(s: Pick<RestartState, "restartedAt" | "acknowledgedAt">): boolean {
  if (!s.restartedAt) return false;
  return !s.acknowledgedAt || new Date(s.acknowledgedAt) < new Date(s.restartedAt);
}

export const shouldAutoReplay = (s: Pick<RestartState, "autoReplay" | "baselineFixtureId">) =>
  s.autoReplay && !!s.baselineFixtureId;
