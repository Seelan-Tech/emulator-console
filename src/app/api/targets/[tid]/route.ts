import { encrypt } from "@/lib/crypto";
import { one } from "@/lib/db";
import { isUniqueViolation } from "@/lib/errors";
import { body, HttpError, json, route } from "@/lib/http";
import { targetUpdate } from "@/lib/schemas";
import { getTarget, publicTarget, safeFilesDir, type TargetRow } from "@/lib/targets";

type P = { tid: string };

export const GET = route<P>(async (_req, { tid }) => {
  return json(publicTarget(await getTarget(tid)));
});

export const PATCH = route<P>(async (req, { tid }) => {
  const cur = await getTarget(tid);
  const u = await body(req, targetUpdate);
  if (cur.auth_mode === "files" && (u.accessKeyId || u.secretAccessKey))
    throw new HttpError(400, "this target reads its credentials from files");
  if (cur.auth_mode === "static" && u.filesDir) throw new HttpError(400, "this target uses static credentials");
  if (u.filesDir) safeFilesDir(u.filesDir);
  if (u.baselineFixtureId) {
    const f = await one<{ id: string }>("select id from fixtures where id = $1", [u.baselineFixtureId]);
    if (!f) throw new HttpError(400, "baseline fixture not found");
  }
  if (u.autoReplay && cur.auth_mode !== "files")
    throw new HttpError(
      400,
      "automatic replay needs a target that reads the emulator's credential files (restart can't be detected otherwise)",
    );
  if (u.autoReplay && !(u.baselineFixtureId ?? cur.baseline_fixture_id))
    throw new HttpError(400, "choose a baseline fixture first");
  const cols: Record<string, unknown> = {
    name: u.name,
    endpoint_url: u.endpointUrl,
    region: u.region,
    tls_servername: u.tlsServername,
    ca_pem: u.caPem,
    access_key_id: u.accessKeyId,
    secret_key_enc: u.secretAccessKey ? encrypt(u.secretAccessKey) : undefined,
    files_dir: u.filesDir,
    baseline_fixture_id: u.baselineFixtureId,
    auto_replay: u.autoReplay,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (!set.length) return json(publicTarget(cur));
  try {
    const row = await one<TargetRow>(
      `update targets set ${set.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1 returning *`,
      [tid, ...set.map(([, v]) => v)],
    );
    return json(publicTarget(row!));
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "a target with this name already exists");
    throw e;
  }
});

export const DELETE = route<P>(async (_req, { tid }) => {
  await getTarget(tid);
  await one("delete from targets where id = $1", [tid]);
  return json({ ok: true });
});
