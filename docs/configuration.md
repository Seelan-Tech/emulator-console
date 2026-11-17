# Configuration reference

<!-- Generated from src/lib/env.ts by `npm run env:example`. Do not edit by hand. -->

The console is configured with environment variables. With Docker Compose, set them in the shell or in a `.env` file next to `compose.yaml`; `compose.yaml` already passes the ones it needs to the `console` service. A value that is present but invalid stops the app at start-up with a message naming the variable.

A ready-to-edit template is in [`.env.example`](../.env.example).

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Directory holding the console's SQLite database (emulator-console.db). Created if missing. In Compose it is /data, on a volume. |
| `APP_SECRET` | **required** | At least 32 random characters. Encrypts target secrets at rest; rotating it invalidates stored target secrets. Required. |
| `DOCS_URL` | unset | Where the Help button in the header points. Unset, it opens the user guide of the version you run (its release tag on GitHub). Set it to your own copy of the guide if you keep one. |
| `LOG_LEVEL` | `info` | Verbosity of server logs: debug, info, warn or error. |

## Access

| Variable | Default | Description |
| --- | --- | --- |
| `LOCAL_ALLOWED_HOSTS` | unset | Extra Host header names the console accepts (comma-separated), besides localhost, 127.0.0.1 and [::1]. Requests with any other Host are refused (DNS-rebinding defence). |

## Targets and credentials

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOW_LOCAL_CREDENTIAL_FILES` | `false` | Let targets read the emulator's own credential files (restart detection depends on this). |
| `LOCAL_CREDENTIALS_ROOT` | `/emu` | Directory holding the emulator's per-port credential folders (mounted read-only). |
| `LOCAL_TARGET_ENDPOINT` | unset | Endpoint of the Local emulator target the console creates by itself. Defaults to `https://emulator:<port>`. |
