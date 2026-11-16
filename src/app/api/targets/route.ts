import { encrypt } from "@/lib/crypto";
import { one, query } from "@/lib/db";
import { isUniqueViolation } from "@/lib/errors";
import { body, HttpError, json, route } from "@/lib/http";
import { targetCreate } from "@/lib/schemas";
import { publicTarget, safeFilesDir, type TargetRow } from "@/lib/targets";

export const GET = route(async () => {
  const rows = await query<TargetRow>("select * from targets order by created_at");
  return json(rows.map(publicTarget));
});

export const POST = route(async (req) => {
  const t = await body(req, targetCreate);
  if (t.authMode === "files") safeFilesDir(t.filesDir!); // validates root + feature flag
  try {
    const row = await one<TargetRow>(
      `insert into targets(name, endpoint_url, region, tls_servername, ca_pem, auth_mode, access_key_id, secret_key_enc, files_dir)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        t.name,
        t.endpointUrl,
        t.region,
        t.tlsServername ?? null,
        t.caPem ?? null,
        t.authMode,
        t.authMode === "static" ? t.accessKeyId : null,
        t.authMode === "static" ? encrypt(t.secretAccessKey!) : null,
        t.authMode === "files" ? t.filesDir : null,
      ],
    );
    return json(publicTarget(row!), 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "a target with this name already exists");
    throw e;
  }
});
