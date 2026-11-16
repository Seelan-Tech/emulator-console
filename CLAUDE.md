# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Emulator Console**: a local developer tool (Next.js 15 + SQLite; not meant to be hosted or shared; no login) for use with the **AWS Emulator** (an in-memory emulator that AWS publishes, installed from AWS's signed package by `docker/emulator.Dockerfile`). The emulator speaks the real AWS wire protocols but has no UI and no admin/listing API (only `GET /__admin/health`). This app adds saved targets, native service screens, recordable/replayable fixtures and an activity log. The repository is self-contained: everything needed to build, run and test it is in this directory. Design, schema, API and security notes are in `docs/` (start with `docs/developer-guide.md`); read it before changing the app.

## Commands

```sh
docker compose up -d --build            # emulator :9297, console http://127.0.0.1:3000
docker compose up -d --build console   # REQUIRED after any change to the app (its files are baked into the image)
docker compose down

npm run verify                          # lint + format check + typecheck + unit/component tests + build
npm test                                # unit + component tests (fast, no Docker)
npm run test:int                        # DB-backed integration tests against a temporary SQLite file (no Docker)
npm run test:cov                        # everything, with coverage thresholds
npm run e2e | e2e:restart   # Playwright against a THROWAWAY compose stack (scripts/e2e-stack.sh): never your own emulator
npm run e2e:live                        # Playwright against whatever is on E2E_BASE_URL (default :3000); specs clean up after themselves
```

Overrides (shell env or `.env`): `EMU_PORT`, `CONSOLE_PORT`, `EMU_STATE_DIR`, `APP_SECRET` (set your own; the compose default is for local use only). The compose project is named `emulator-console` (`name:` in `compose.yaml`). The e2e stacks use projects `ec-e2e-<mode>` on ports 31xx/93xx and state under `.e2e/`.

**E2E and the disk.** Rebuilding images adds hundreds of MB of Docker build cache each time; when the Docker VM disk fills, builds fail and the database cannot write. After rebuilds run `docker image prune -f && docker builder prune -f --keep-storage 1500MB`. `e2e/global-teardown.ts` fails the local run if a spec leaked `e2e-*`/`pal-*`/`secret-*` resources.

Talking to the emulator with the AWS CLI (it requires SigV4 + its private CA, so all of these are needed):

```sh
export AWS_ENDPOINT_URL=https://127.0.0.1:9297 AWS_SHARED_CREDENTIALS_FILE=~/.aws/emulator/9297/emulator_credentials \
  AWS_CONFIG_FILE=~/.aws/emulator/9297/config AWS_CA_BUNDLE=~/.aws/emulator/9297/ca.pem \
  AWS_EC2_METADATA_DISABLED=true AWS_DISABLE_HOST_PREFIX_INJECTION=true AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
```

## Architecture (short; details in `README.md`)

Browser → Next.js app → AWS SDK v3 → emulator. The browser can't do SigV4 or trust the emulator's private CA, so the server holds credentials; they never reach the browser. All calls go through one generic runner, `POST /api/targets/:tid/:svc/:op` (`src/app/api/targets/[tid]/[svc]/[op]/route.ts` → `lib/execute.ts`: per-target concurrency cap + audit row), plus S3-only binary `_upload` / `_download`. `lib/aws.ts` is the service registry (static SDK loaders; to add a service add a `client-*` dependency, a loader and a registry entry). Targets resolve to a connection in `lib/targets.ts` (static encrypted keys, or `files` mode reading the emulator's own credentials + CA, re-read when they change).

Rules that matter:

- There is no login. The protection is the `Host` allowlist in `src/middleware.ts` (DNS-rebinding defence, `lib/host.ts`) and the `Origin` check in `lib/http.ts`; keep both. Target secrets are encrypted with `APP_SECRET` (`lib/crypto.ts`). Load targets and fixtures with `getTarget`/`getFixture`.
- Screens: all calls go through `lib/aws-client.ts` hooks (`useOp`, `useMutateOp`, `useRunOp`): they cache, invalidate by service, and record state-changing calls for fixtures (`DeleteMessage`/`Invoke`/reads are not recorded). Per-item detail calls are made sequentially (the emulator drops parallel bursts). Generated forms come from the SDK's Smithy schemas (`lib/schema.ts`, golden-tested).
- DynamoDB: `features/dynamodb/query.ts` is the only place that builds Query/Scan requests (pure, unit-tested). DynamoDB applies `Limit` before filters, so a filtered page can be empty while a next key exists: the table view must keep paging (and only steps back after a real delete). Palette: `features/palette/items.ts` + `lib/fuzzy.ts` are pure and tested; React list keys must include the group (an item can appear as both Recent and Go to).
- Restart recovery: files-mode targets are fingerprinted by access-key id (`lib/restart*.ts`); the watcher in `instrumentation.ts` replays the baseline fixture after a restart when `auto_replay` is on.

## Docker topology and gotchas

- The emulator image writes credentials, CA and AWS config to `$HOME/.aws/emulator/<port>/`. Compose sets `HOME` to the host home and mounts `~/.aws/emulator` at the same path, so the host CLI and the app use the same files. **Keys are regenerated on every emulator restart.**
- The emulator's TLS cert is valid only for `localhost`/`127.0.0.1`. The app connects to `https://emulator:9297` but verifies as `localhost` (target `tls_servername`). Sharing the emulator's network namespace was tried and breaks when the emulator restarts.
- The emulator binds `0.0.0.0` inside its container (image entrypoint); compose publishes ports on `127.0.0.1` only.
- All emulator state is in memory and lost on restart. `docker/emulator.Dockerfile` installs the RPM that matches the build machine (`uname -m`: aarch64 or x86_64), at the version pinned by `ARG EMULATOR_VERSION` and GPG-verified. Never switch it to `latest/`; `.github/workflows/emulator-update.yml` opens the bump PRs (docs/emulator-setup.md).

## Emulator behaviours that shaped the code

- Parallel request bursts make the emulator drop connections (`socket hang up`): discovery runs 4 at a time with retries, per-target calls are capped at 4 in flight, and screens fetch per-item details sequentially.
- `run()` destroys the SDK client after each call, so streaming bodies (S3 `GetObject`) must be read inside `run()` first, otherwise large downloads fail with `aborted`.
- Large single `PutObject` (~20 MB) fails; `_upload` switches to multipart above 8 MB. Each bucket is capped at 64 MiB.
- DynamoDB tables report `CREATING` briefly (and cannot be deleted then); Lambda functions stay `Pending` for a few seconds after create/update and reject invokes until `Active`.
- SNS delivers to SQS only if the queue policy allows the topic. SQS refuses to recreate a deleted queue name for 60 s.
- Lambda actually executes code (Python and Node runtimes tested) and returns logs with `LogType: Tail`.
- The AWS SDK clients (v3.1169) export runtime Smithy schemas (`SendMessageRequest$`, `SendMessage$`), usable to generate input forms.
