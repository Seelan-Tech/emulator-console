# Developer guide

How the code is organised, how to test it, and how to add to it. [`CONTRIBUTING.md`](../CONTRIBUTING.md) covers the process (branches, commits, reviews).

## Setup

```sh
nvm use                       # Node 24, from .nvmrc
npm ci
cp .env.example .env          # set APP_SECRET
npm run dev                   # creates ./data/emulator-console.db and applies db/migrations
```

`npm run verify` runs what CI runs: lint, format check, type check, unit and component tests and the production build.

## Architecture

```text
Browser (React) ──► Next.js app ──► SQLite file
   TanStack Query     pages: server components      targets, fixtures,
   native screens     API:   route handlers /api/*  fixture_runs, audit_log
                          └─► AWS SDK v3 ──► emulator
```

- **One transport.** Every call to the emulator goes through `POST /api/targets/:tid/:svc/:op` (`src/app/api/targets/[tid]/[svc]/[op]/route.ts`), which calls `lib/execute.ts`: a per-target limit of four calls in flight, and an audit row. The browser never sees credentials.
- **`lib/aws.ts`** is the service registry and the typed boundary around the SDK. To add a service: add its `@aws-sdk/client-*` dependency, a loader and a registry entry.
- **`lib/targets.ts`** turns a target row into a connection: static encrypted keys, or the emulator's credential files (re-read when they change).
- **Generated forms.** `lib/schema.ts` decodes the Smithy schemas the SDK ships into a small field tree; `features/runner/schema-form.tsx` renders it.
- **Client hooks.** `lib/aws-client.ts` (`useOp`, `useMutateOp`, `useRunOp`) cache reads, invalidate by service after writes, and record state-changing calls for fixtures.
- **Fixtures.** `lib/fixtures.ts` is the replay engine (retries, delays), `lib/fixture-runs.ts` runs it against a target and stores the result, `lib/restart*.ts` detect restarts.
- **Configuration.** `lib/env.ts` is the only place environment variables are read. `ENV_DOCS` in it generates `.env.example` and [the configuration reference](configuration.md) (`npm run env:example`); a test fails if they drift.

Rules that matter:

- There is no login, so the protection is the `Host` allowlist (`src/middleware.ts`, `lib/host.ts`) and the `Origin` check in `lib/http.ts`: keep both on every route and never weaken them.
- Load targets and fixtures through `getTarget` and `getFixture`, which answer `404` for unknown or malformed ids.
- React list keys in the palette must include the group, because an item can appear as both Recent and Go to.

## Database

SQLite (the built-in `node:sqlite`), one file in `DATA_DIR`. `lib/db.ts` opens it on first use, applies the numbered files in `db/migrations` that `PRAGMA user_version` has not seen yet, and exposes `query`, `one` and `firstRow` with `$1`-style placeholders. Booleans are stored as 0/1 and the JSON columns (`steps`, `results`) as text; `db.ts` converts them back. Timestamps are ISO 8601 strings (`NOW` in SQL).

| Table | Purpose |
| --- | --- |
| `targets` | emulator endpoints: `static` (key plus encrypted secret, optional CA) or `files`; `tls_servername`; the baseline fixture, `auto_replay`, `instance_fingerprint`, `restarted_at` and `restart_acknowledged_at` |
| `fixtures` | replayable recipes: `steps jsonb` |
| `fixture_runs` | per-step results (`ok`, `ms`, `attempts`, `error`; outputs are not stored) and the `trigger`, `manual` or `restart` |
| `audit_log` | what was called: service, operation, `mutating`, outcome, duration, error. Inputs are never stored |

## Code style

ESLint (type-checked, no `any`, no `console`), Prettier (width 120) and import sorting are enforced by a pre-commit hook and by CI. Server logging goes through `lib/log.ts`.

## Tests

| Command | Scope |
| --- | --- |
| `npm test` | Unit tests (`src/**/*.test.ts`) and component tests (`src/**/*.test.tsx`, jsdom, Testing Library). Fast, no Docker |
| `npm run test:int` | Integration tests (`tests/integration`) against a temporary SQLite file (no Docker) |
| `npm run test:cov` | All of the above with coverage thresholds |
| `npm run e2e`, `e2e:restart` | Playwright against a throwaway Docker stack (`scripts/e2e-stack.sh`), and the same with an emulator restart |
| `npm run e2e:live` | Playwright against whatever is running on `E2E_BASE_URL` |

Unit tests use Vitest. Integration tests call the route handlers directly, against a temporary SQLite database (`tests/setup/integration.ts`); helpers are in `tests/support/`. The e2e stacks use their own compose project, ports (31xx, 93xx), database and emulator state under `.e2e/`, so your own emulator is never touched. After the local suite, a teardown removes and **fails on** any `e2e-*`, `pal-*` or `secret-*` resource a test left behind; accessibility checks (axe) run in `e2e/a11y.spec.ts`.

## Adding a service screen

1. Make sure the service is in `lib/aws.ts` and `features/services.ts`.
2. Create `src/features/<service>/` with the screens, using the `lib/aws-client.ts` hooks so reads are cached and writes are recorded.
3. Add routes under `src/app/t/[tid]/<service>/` and set `native` on the service's entry in `features/services.ts` so the sidebar links to the screen.
4. Put pure logic in its own file with unit tests; add an e2e spec that cleans up after itself, using a unique name prefix (`uniq("e2e-…")`).
5. Add it to the palette in `features/palette/items.ts` if it has resources worth searching.

## Documentation and screenshots

The guide is the Markdown in `docs/`. Screenshots in `docs/images` are generated, not hand-made:

```sh
npm run docs:screenshots
```

This starts a throwaway stack, seeds example resources and photographs the main screens in light and dark. Re-run it after a UI change and commit the images. CI lints the Markdown and checks every link (`.github/workflows/docs.yml`).

Docs are versioned by git tag: every release tag contains the guide as it was, and the Help button opens `docs/` at the running version (`lib/docs-url.ts`, version from `package.json` at build time; `DOCS_URL` overrides it). When a change alters behaviour a user may rely on, say "since x.y.z" in the page.

## Releasing

1. Make sure `main` is green, and move the `CHANGELOG.md` entries from "Unreleased" under the new version, and update the link definitions at the bottom (add the new version, and point `[Unreleased]` at it).
2. Regenerate the dependency notices with `npm ci && npm run notices` and commit them if they changed.
3. Set the version in `package.json`, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
4. The release workflow builds a multi-arch console image, pushes it to `ghcr.io/seelan-tech/emulator-console` and creates the GitHub release with generated notes. The emulator image is never published: it is built locally from AWS's signed package.

## Branch protection

The rules for `main` live in `.github/rulesets/main.json`: changes go through a pull request, every CI check must pass on an up-to-date branch, history stays linear, and force-pushes and deletion are blocked. Repository admins can bypass through a pull request only. GitHub rulesets need a public repository (or a paid plan), so apply them once, as an admin, after the repository goes public:

```sh
.github/rulesets/apply.sh
```

Re-run it after changing the file. When a CI job is added or renamed, update the check names in `main.json` too.

## Updating the AWS Emulator

The emulator version is pinned in `docker/emulator.Dockerfile` and bumped by PRs from `.github/workflows/emulator-update.yml`. See [Emulator setup and versions](emulator-setup.md) for how to review, apply and roll back a bump.
