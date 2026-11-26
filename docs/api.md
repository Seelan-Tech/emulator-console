# API reference

Everything the console does goes through a JSON API under `/api`. You can call it from scripts; there is nothing to log in to. It is not a stable public API: it may change between versions.

- Requests and responses are JSON unless noted. Errors are `{"error": "message"}` with an HTTP status.
- Unknown and malformed resource ids answer `404`.
- State-changing requests that carry an `Origin` header must match the host, or they are refused with `403`.
- Requests whose `Host` header is not local (see [Security](security.md)) are refused with `403`.

## Targets, fixtures, activity

| Method and path | Purpose |
| --- | --- |
| `GET /api/targets`, `POST` | List targets; create one |
| `GET /api/fixtures`, `POST` | List fixtures; create one (`{ "name", "description", "steps" }`) |
| `GET /api/audit` | Activity. Query: `targetId`, `all=1` (include reads), `limit` (max 200), `before` (id of the last row of the previous page) |
| `GET`, `PATCH`, `DELETE /api/targets/:tid` | Read, edit (including `baselineFixtureId` and `autoReplay`), delete |
| `POST /api/targets/:tid/test` | Connectivity check |
| `GET /api/targets/:tid/info`, `GET …/discovery` | Summary; which services the emulator implements |
| `GET /api/targets/:tid/status` | Restart state, baseline and the latest run. Also triggers detection |
| `POST /api/targets/:tid/restart/ack` | Dismiss the restart banner |
| `POST /api/targets/:tid/baseline/replay` | Replay the baseline fixture now |
| `GET`, `PUT`, `DELETE /api/fixtures/:fid` | Read, edit, delete a fixture |
| `GET /api/fixtures/export` | Every fixture as one file (`emulator-console-fixtures.json`) |
| `POST /api/fixtures/import` | Import a fixture file: `{ "text", "onConflict": "rename" \| "replace" \| "skip", "dryRun" }`. `dryRun` answers what would happen and saves nothing |
| `POST /api/fixtures/:fid/run` | Replay: `{ "targetId", "continueOnError" }` |
| `GET /api/fixtures/:fid/runs` | Run history |

A target is created with:

```json
{
  "name": "Local emulator",
  "endpointUrl": "https://emulator:9297",
  "region": "us-east-1",
  "authMode": "static",
  "accessKeyId": "…",
  "secretAccessKey": "…",
  "tlsServername": "localhost",
  "caPem": "-----BEGIN CERTIFICATE-----…"
}
```

or, for credential files, `"authMode": "files"` and `"filesDir": "9297"` instead of the key fields.

## Running any operation

```http
POST /api/targets/:tid/:service/:operation[?region=eu-west-1]
```

The body is the operation's input exactly as the AWS SDK for JavaScript v3 expects it. Binary values are sent as `{"$base64": "…"}`. The response is always HTTP 200 with an envelope:

```json
{ "ok": true, "ms": 12, "output": { "Buckets": [] } }
```

```json
{ "ok": false, "ms": 8, "error": { "name": "NoSuchBucket", "message": "…", "status": 404 } }
```

`:service` is one of `s3`, `dynamodb`, `sqs`, `sns`, `lambda`, `secretsmanager`, `ssm`, `kms`, `iam`, `sts`, `ec2`, `eventbridge`, `kinesis`, `sfn`, `logs`, `cloudformation`. Calls count against a per-target limit of four at a time.

Example:

```sh
curl -b cookies.txt -H 'content-type: application/json' \
  -d '{"Bucket":"demo-assets"}' \
  http://127.0.0.1:3000/api/targets/$TID/s3/CreateBucket
```

### S3 files

| Request | Purpose |
| --- | --- |
| `PUT /api/targets/:tid/s3/_upload?bucket=&key=` | Upload; the body is the raw file. Large files are sent as a multipart upload |
| `GET /api/targets/:tid/s3/_download?bucket=&key=[&inline=1]` | Download; `inline=1` returns plain text for previews |

## Metadata

| Request | Purpose |
| --- | --- |
| `GET /api/targets/:tid/:service` | The operations of a service |
| `GET /api/schema/:service/:operation` | The operation's input shape, as used by the generated forms |
| `GET /api/operations` | Operation names of every service |
| `GET /api/health` | `200` when the app and database are up, otherwise `503` |
