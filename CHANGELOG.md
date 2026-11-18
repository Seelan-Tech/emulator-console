# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-11-17

### Added

- A **Logs** tab on a Lambda function with its recent runs (from the Invoke tab, the AWS CLI or an SDK, or an SNS subscription): status, duration, memory and the printed output, from the function's CloudWatch log group. JSON that a function prints (and a printed Python dict) is formatted; a **Format JSON** switch turns it off.
- A **Beautify** button in the JSON editors (operation runner, Lambda payloads, DynamoDB items, fixtures, and SNS, SQS and secret bodies).
- A **Use with the AWS CLI** button on the target overview with the exports for that emulator, ready to copy.
- The console version is shown in the header, with an **About** dialog (console, commit, emulator versions and a **Copy details** button for bug reports). Builds that are not a tagged release show their commit (`0.3.0+abc1234`) instead of the release version. `GET /api/health` returns `version` and `revision`.

### Changed

- The SNS subscribe dialog marks `http`, `https`, `email` and `sms` as "will not deliver", because the emulator never confirms those subscriptions.
- The **Help** button opens the user guide of the version you run (its release tag) instead of `main`. `DOCS_URL` still overrides it.
- Release notes link to the guide for that version.

### Fixed

- Subscribing a Lambda function to an SNS topic in the console now allows the topic to invoke it (an **Allow this topic to invoke the function** switch, on by default), as it already did for queues. Before, the function was never invoked and nothing said why.

## [0.2.0] - 2026-11-16

### Added

- S3 bucket list: a **Region** column and an **Only this region** switch, because `ListBuckets` returns buckets of every region.

### Changed

- Bumped the AWS Emulator to 1.0.471.

### Documentation

- Spelled out what a fixture cannot capture (CLI, SDK and script calls, S3 uploads), what a replay does, and that CLI credentials change on every emulator restart.

## [0.1.0] - 2026-11-15

### Added

- First public version of Emulator Console, a local web console for use with the AWS Emulator.
- Native screens for S3, DynamoDB, SQS, Lambda, SNS and Secrets Manager, and generated forms for every operation of 16 services.
- Fixtures: record what you do, replay it, and set a baseline that is replayed automatically after an emulator restart.
- Command palette (Ctrl/Cmd+K), an activity log, light and dark themes.
- The emulator build is shown next to each local target.
- Docker Compose stack: the emulator (pinned to a version and verified against AWS's signature, telemetry off by default) and the console, with its data in a SQLite file.
- User guide in `docs/`.

[Unreleased]: https://github.com/Seelan-Tech/emulator-console/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Seelan-Tech/emulator-console/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Seelan-Tech/emulator-console/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Seelan-Tech/emulator-console/releases/tag/v0.1.0
