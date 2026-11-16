# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-15

### Added

- First public version of Emulator Console, a local web console for use with the AWS Emulator.
- Native screens for S3, DynamoDB, SQS, Lambda, SNS and Secrets Manager, and generated forms for every operation of 16 services.
- Fixtures: record what you do, replay it, and set a baseline that is replayed automatically after an emulator restart.
- Command palette (Ctrl/Cmd+K), an activity log, light and dark themes.
- The emulator build is shown next to each local target.
- Docker Compose stack: the emulator (pinned to a version and verified against AWS's signature, telemetry off by default) and the console, with its data in a SQLite file.
- User guide in `docs/`.

[Unreleased]: https://github.com/Seelan-Tech/emulator-console/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Seelan-Tech/emulator-console/releases/tag/v0.1.0
