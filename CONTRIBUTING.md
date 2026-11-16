# Contributing

Thanks for helping improve Emulator Console, a local developer tool for use with the AWS Emulator (it is not designed to be hosted). This guide covers getting set up, the checks every change must pass, and how changes are reviewed. By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Setup

Requirements: Node.js 24 (`nvm use` reads `.nvmrc`), Docker with Compose v2, and Google Chrome for the browser tests.

```sh
npm ci
cp .env.example .env              # then set APP_SECRET
npm run dev                       # http://localhost:3000
```

To run the whole product (emulator and console) use `docker compose up -d --build`; see the [user guide](docs/index.md).

## The checks

Run everything CI runs with one command:

```sh
npm run verify        # lint + format check + typecheck + unit tests + build
```

| Command | What it does |
|---|---|
| `npm run lint` / `npm run format` | ESLint / Prettier (a pre-commit hook runs both on staged files) |
| `npm run typecheck` | TypeScript in strict mode |
| `npm test` / `npm run test:cov` | unit tests, optionally with coverage thresholds |
| `npm run test:int` | database-backed API and integration tests (a temporary SQLite file; no Docker) |
| `npm run e2e` | Playwright against an isolated stack (see `scripts/e2e-stack.sh`) |

New behaviour needs tests: pure logic gets unit tests, API rules get integration tests, and user-visible flows get an e2e spec. Bug fixes start with a test that fails.

## Pull requests

1. Branch from `main`; keep a PR to one logical change.
2. Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages and the PR title (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Squash-merging keeps history readable.
3. CI must be green before a change is merged (the `main` branch requires it). Fill in the PR template, including how you tested the change.
4. Never commit secrets. `.env` is ignored; real credentials belong in your environment, not the repository.

## Reporting problems

Use the issue templates. For security problems follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Licensing of contributions

Emulator Console is released under the [MIT license](LICENSE). By submitting a pull request you confirm that you wrote the change (or have the right to submit it) and that it may be distributed under that license.
