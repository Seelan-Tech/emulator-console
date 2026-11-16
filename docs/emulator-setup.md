# AWS Emulator setup and versions

The console talks to the [AWS Emulator](https://docs.aws.amazon.com/emulator/latest/userguide/what-is-service.html), an in-memory emulator that AWS publishes as open source ([aws/aws-emulator](https://github.com/aws/aws-emulator), CC0) and ships as signed packages. There is no prebuilt container image, so this repository builds one from `docker/emulator.Dockerfile`.

## The version is pinned

The Dockerfile installs one exact release, set by a single line:

```dockerfile
ARG EMULATOR_VERSION=1.0.385
```

It does not use AWS's `latest/` URL. AWS notes that fidelity fixes can change test results, so an image rebuilt on a new day must not quietly behave differently. The version you build is the version you tested.

The build also checks the package before installing it:

1. It downloads `aws-emulator-<version>-1-<arch>.rpm` and its detached `.sig` from `downloads.aws.com` (`<arch>` is `x86_64` or `aarch64`, picked from the build machine).
2. It imports AWS's publishing key and requires its fingerprint to be exactly `98BC F336 A3BE 53B7 34E9 67C5 2E5B F49B D940 F624`.
3. It runs `gpg --verify`. A wrong version, a missing file or a bad signature fails the build.
4. After installing, it checks that `rpm -q aws-emulator` reports the pinned version. The image carries the label `aws-emulator.version`.

To see what an image contains:

```sh
docker image inspect aws-emulator --format '{{ index .Config.Labels "aws-emulator.version" }}'
```

## Trying another version

```sh
docker compose build --build-arg EMULATOR_VERSION=1.0.382 emulator
```

This changes only the image. Recreating the container (`docker compose up -d emulator`) restarts the emulator and wipes its in-memory state, so do it when you are ready to replay your [fixtures](fixtures.md).

## How upgrades happen

Dependabot cannot watch an RPM download, so the **Emulator update** workflow (`.github/workflows/emulator-update.yml`) does the same job:

1. Every Monday it compares the pin with the newest [GitHub release](https://github.com/aws/aws-emulator/releases) of the emulator. You can also run it by hand from the Actions tab.
2. If there is a newer one, and the RPMs and signatures for both architectures are published, it opens a PR named `chore(emulator): bump AWS Emulator to <version>` that changes only the `ARG` line.
3. It starts CI on that branch: lint, tests, both image builds and every Playwright suite (local and restart) run against the new version.
4. **You merge it** once CI is green and you have skimmed the release notes. Nothing upgrades on its own.

Dependabot continues to handle npm, Docker base images and GitHub Actions (`.github/dependabot.yml`).

### Reviewing a bump PR

- All checks are green, in particular the three e2e jobs.
- The release notes (linked in the PR) mention nothing that changes the services you rely on.
- For a minor or major bump, try it locally first: build with `--build-arg`, recreate the emulator, and replay a fixture.

AWS publishes security fixes only in the latest release, so do not let bump PRs sit for long. Merging within a week or two keeps the gap small.

### Applying a merged bump to a running stack

```sh
git pull
docker compose up -d --build emulator
```

The emulator restarts and loses its state; its access keys are regenerated. The console notices the restart and offers to replay the baseline fixture (see [restart recovery](concepts.md)).

### Rolling back

Revert the bump commit (or set the previous version in the `ARG` line), then rebuild and recreate the emulator as above. Emulator state is not migrated between versions, so a rollback is the same as any restart.

## Telemetry

The AWS Emulator sends anonymous usage and error data to AWS **unless it is switched off**; see AWS's [telemetry documentation](https://docs.aws.amazon.com/emulator/latest/userguide/telemetry.html) for what is collected. AWS asks tools that bundle the emulator to tell their users and let them turn it off, so:

- The Compose stack in this repository starts the emulator with `EMULATOR_TELEMETRY=off`. Nothing is sent.
- To allow it, set `EMULATOR_TELEMETRY=on` in your shell or `.env` before `docker compose up -d`, and recreate the emulator container (this restarts it and wipes its state).
- An "off" setting always wins: AWS's own settings (the `--telemetry` flag, the `EMULATOR_TELEMETRY` variable and `config.toml` in `~/.aws/emulator`, which the Compose stack shares with your host) are all honoured, and any one of them turning telemetry off is enough.
- **Emulator Console itself collects and sends nothing.** Its only network traffic is to the targets you configure; the Help button just opens a link in your browser.

## Showing the version in the console

The Targets page and the target header show the running emulator build, for example `Emulator 1.0.385`. The emulator has no version endpoint, so the console reads a small `version` file that the emulator image writes next to its credentials (`~/.aws/emulator/<port>/version`).

- **With this repository's Compose stack: nothing to do.** The image's entrypoint (`docker/emulator-entrypoint.sh`) writes the file every time the emulator starts, so the tag follows restarts and upgrades. An emulator started from an image that predates this feature shows no tag until you rebuild and restart it.
- **With an emulator you run yourself** (an RPM on a host, or your own image): add one step to however you start it, so the file is written on every start:

  ```sh
  mkdir -p ~/.aws/emulator/9297 && aws-emulator --version > ~/.aws/emulator/9297/version
  ```

  Use your emulator's port in place of `9297`. The emulator leaves the file alone. Or copy `docker/emulator-entrypoint.sh` and use it as the image entrypoint.
- **The target must read the emulator's files.** That means a target with **emulator files** credentials, `ALLOW_LOCAL_CREDENTIAL_FILES=true`, and the credentials folder mounted into the console (`LOCAL_CREDENTIALS_ROOT`). Targets with static keys, or an emulator on another machine, show no tag. This is by design: the console has nothing to read there.

If the file is missing or unreadable, the tag is hidden and nothing else changes.

## Not using Docker

On a host, install the package the way AWS documents it, for example `sudo dnf install -y https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-1.0.385-1-x86_64.rpm`, and point a target at it. The console only needs the emulator's endpoint and its credentials folder; see [Getting started](getting-started.md). To see the version in the console, write the `version` file at start as described above.
