# Troubleshooting

## The emulator restarted and my resources are gone

That is how the emulator works: its state is in memory. Record your setup as a [fixture](fixtures.md), set it as the target's baseline, and turn on automatic replay.

## "No space left on device"

Every image rebuild adds Docker build cache. When the Docker disk fills, builds fail and the console's database cannot write. Free space, then restart the console:

```sh
docker image prune -f
docker builder prune -f --keep-storage 1500MB
docker compose restart console
```

## My target says it cannot connect

- **Certificate errors.** The emulator's certificate is only valid for `localhost`. A target that connects to `emulator:9297` must set **Verify TLS as** to `localhost`. Credential-files targets do this for you.
- **403 "Host not allowed" in the browser.** You reached the console through a name other than `localhost`, `127.0.0.1` or `[::1]`. Use one of those, or list the name in `LOCAL_ALLOWED_HOSTS`.
- **"emulator credentials not found".** The emulator has not started yet or the credentials directory is wrong. In Compose, the files live under `~/.aws/emulator/<port>/` on the host.
- **`socket hang up`.** The emulator drops connections under bursts of parallel requests. The console limits itself to four calls at a time per target and retries discovery; if you script against the API, do the same.

## S3: upload fails or a bucket refuses more data

Each bucket is capped at 64 MiB, and a single `PutObject` of roughly 20 MB fails. The console switches to multipart above 8 MB, so a large upload that fails is almost certainly the bucket cap.

## SQS: a queue cannot be recreated right after deleting it

The emulator refuses to recreate a queue with the name of one deleted in the last 60 seconds. Wait a minute or pick a new name.

## DynamoDB: the table will not delete

A table is **CREATING** for a few seconds and cannot be deleted until it is **ACTIVE**. Try again shortly.

## DynamoDB: a filtered query shows an empty page

DynamoDB applies the page size before the filter, so a page can be empty while more matches follow. Press **Next**; the console keeps paging through empty pages for you.

## Lambda: "function is pending"

After a function is created or its code or configuration is updated it stays **Pending** for a few seconds, and invocations fail until it is **Active**.

## SNS publishes but the queue receives nothing

The queue's policy must allow the topic to send to it. Subscribe with **Allow topic in queue policy** switched on, or add the statement yourself.

## The console refuses to start

The start-up message names the variable. Typical causes: `APP_SECRET` missing (the secret needs at least 32 characters), or an invalid value (a bad `LOG_LEVEL`, for example).

## The emulator version is not shown

The tag appears only for targets that read the emulator's own credential files, and only if the emulator wrote its `version` file. Check, in order:

1. The target uses **emulator files** credentials (static-key targets never show one).
2. The credentials folder is mounted into the console and `ALLOW_LOCAL_CREDENTIAL_FILES` is `true`.
3. `~/.aws/emulator/<port>/version` exists. If not, the emulator was started from an image that predates the feature (or without the entrypoint): rebuild the emulator image and restart it, or write the file yourself, see [Emulator setup](emulator-setup.md#showing-the-version-in-the-console).

## Known limitations

- Fixtures replay calls, not state. A step that depends on an id returned by an earlier step must be edited by hand.
- Calls made with the AWS CLI, an SDK or a script are not recorded, only console actions are: see [what a fixture cannot capture](fixtures.md#what-a-fixture-cannot-capture).
- S3 uploads are not recorded. Lambda zips are recorded as base64, which can be large. `DeleteMessage` is not recorded.
- The DynamoDB query builder covers Query and Scan with key conditions and filters. There is no `IN` operator, no projection expression and no parallel scan; use the operation runner.
- Restart detection needs a target that reads the emulator's credential files.

## Still stuck

Check the container logs (`docker compose logs console`), then open an issue with the log lines and what you expected.
