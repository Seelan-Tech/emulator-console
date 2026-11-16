import { isService } from "@/lib/aws";
import { reviveBase64 } from "@/lib/binary-input";
import { execute, logAudit } from "@/lib/execute";
import { HttpError, json, route, sdkJson } from "@/lib/http";
import { getTarget } from "@/lib/targets";

type P = { tid: string; svc: string; op: string };

const PART_SIZE = 8 * 1024 * 1024;
// The emulator rejects large single PutObject calls (as the AWS CLI does, switch to multipart).

async function load(tid: string, svc: string) {
  const target = await getTarget(tid);
  if (!isService(svc)) throw new HttpError(404, "unknown service");
  return { ctx: { target, source: "console" as const }, service: svc };
}

// Generic operation runner: any SDK command by name, SDK-shaped JSON in, {ok, ms, output|error} out.
// Binary inputs can be sent as {"$base64": "..."}.
export const POST = route<P>(async (req, { tid, svc, op }) => {
  const { ctx, service } = await load(tid, svc);
  if (!/^[A-Za-z0-9]{1,100}$/.test(op)) throw new HttpError(400, "invalid operation name");
  const text = await req.text();
  const input = text ? reviveBase64(JSON.parse(text) as unknown) : {};
  const region = new URL(req.url).searchParams.get("region") ?? undefined;
  const r = await execute(ctx, service, op, input, region);
  return sdkJson(r.ok ? { ok: true, ms: r.ms, output: r.output } : { ok: false, ms: r.ms, error: r.error });
});

// S3 binary download: GET .../s3/_download?bucket=&key=[&inline=1]
export const GET = route<P>(async (req, { tid, svc, op }) => {
  const { ctx } = await load(tid, svc);
  if (svc !== "s3" || op !== "_download") throw new HttpError(404, "not found");
  const q = new URL(req.url).searchParams;
  const Bucket = q.get("bucket"),
    Key = q.get("key");
  if (!Bucket || !Key) throw new HttpError(400, "bucket and key required");
  const r = await execute(ctx, "s3", "GetObject", { Bucket, Key }, q.get("region") ?? undefined);
  if (!r.ok) throw new HttpError(r.error.name === "NoSuchKey" ? 404 : 502, r.error.message);
  const out = r.output as { Body: Uint8Array; ContentType?: string };
  const inline = q.has("inline");
  const name = Key.split("/")
    .pop()!
    .replace(/["\r\n]/g, "");
  return new Response(Buffer.from(out.Body), {
    headers: {
      "content-type": inline ? "text/plain; charset=utf-8" : (out.ContentType ?? "application/octet-stream"),
      ...(inline ? {} : { "content-disposition": `attachment; filename="${name}"` }),
      "x-content-type-options": "nosniff",
    },
  });
});

// S3 binary upload: PUT .../s3/_upload?bucket=&key= with the raw file as the body.
export const PUT = route<P>(async (req, { tid, svc, op }) => {
  const { ctx } = await load(tid, svc);
  if (svc !== "s3" || op !== "_upload") throw new HttpError(404, "not found");
  const q = new URL(req.url).searchParams;
  const Bucket = q.get("bucket"),
    Key = q.get("key");
  if (!Bucket || !Key) throw new HttpError(400, "bucket and key required");
  const region = q.get("region") ?? undefined;
  const data = Buffer.from(await req.arrayBuffer());
  const ContentType = req.headers.get("content-type") ?? undefined;
  const started = Date.now();
  const fail = (e: { message: string }) => {
    logAudit(ctx, "s3", "PutObject", false, Date.now() - started, e.message);
    throw new HttpError(502, e.message);
  };

  if (data.length <= PART_SIZE) {
    const r = await execute(ctx, "s3", "PutObject", { Bucket, Key, Body: data, ContentType }, region);
    if (!r.ok) throw new HttpError(502, r.error.message);
    return json({ ok: true });
  }
  const create = await execute(ctx, "s3", "CreateMultipartUpload", { Bucket, Key, ContentType }, region, {
    audit: false,
  });
  if (!create.ok) return fail(create.error);
  const UploadId = (create.output as { UploadId?: string }).UploadId;
  if (!UploadId) return fail({ message: "the emulator returned no multipart upload id" });
  const parts: { ETag: string; PartNumber: number }[] = [];
  for (let off = 0, n = 1; off < data.length; off += PART_SIZE, n++) {
    const r = await execute(
      ctx,
      "s3",
      "UploadPart",
      { Bucket, Key, UploadId, PartNumber: n, Body: data.subarray(off, off + PART_SIZE) },
      region,
      { audit: false },
    );
    if (!r.ok) {
      await execute(ctx, "s3", "AbortMultipartUpload", { Bucket, Key, UploadId }, region, { audit: false });
      return fail(r.error);
    }
    parts.push({ ETag: (r.output as { ETag?: string }).ETag ?? "", PartNumber: n });
  }
  const done = await execute(
    ctx,
    "s3",
    "CompleteMultipartUpload",
    { Bucket, Key, UploadId, MultipartUpload: { Parts: parts } },
    region,
    { audit: false },
  );
  if (!done.ok) return fail(done.error);
  logAudit(ctx, "s3", "PutObject", true, Date.now() - started);
  return json({ ok: true });
});
