# Security

## Scope and threat model

The console is a local developer tool. It has **no login** and is meant to be reachable only from your own machine. What it defends against is a web page you happen to open (DNS rebinding and cross-site requests aimed at `localhost`), not a hostile user on a network. Do not publish its port, put it behind a public reverse proxy or share it between people.

## Who can reach it

- Every Compose port is published on `127.0.0.1` only.
- **Host check.** Requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` (or a name listed in `LOCAL_ALLOWED_HOSTS`) are refused with `403`. A malicious site that points its own domain at `127.0.0.1` would send its own name as `Host`, so it cannot use your browser to call the console. This applies to every page and API route (`src/middleware.ts`).
- **Origin check.** State-changing API requests that carry an `Origin` header for another site are refused with `403`.
- At start-up the console logs a reminder that it has no login.

## Targets and credentials

- A target's secret access key is encrypted with AES-256-GCM using a key derived from `APP_SECRET`, and never sent to the browser. Set your own `APP_SECRET`; changing it later makes stored target secrets unreadable.
- **Credential-files mode** reads the emulator's own keys from a directory under `LOCAL_CREDENTIALS_ROOT`. It is off unless `ALLOW_LOCAL_CREDENTIAL_FILES=true` (Compose turns it on), and paths that escape the root are refused.
- A target URL is whatever you type: the console will call it. Point targets only at emulators you trust.

## Privacy

Emulator Console collects and sends nothing: no analytics, no crash reports, no update checks. Its only network traffic is to the targets you configure. The AWS Emulator it works with can send anonymous telemetry to AWS; the Compose stack turns that off by default, see [Emulator setup](emulator-setup.md#telemetry).

## Fixtures can contain secrets

Fixture steps are stored as plain JSON. If you create a secret in the console, the recorded `CreateSecret` step contains the value you typed; recorded Lambda environment variables are likewise included. Treat fixtures like code that may hold credentials, and use throwaway values. The **activity log** never stores request inputs.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md).
