# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **EventBridge screens**: event buses (create, delete; the default bus stays), the rules on a bus (an event pattern or a schedule, an enabled switch, edit and delete), each rule's targets (queues, functions, topics or any ARN, with an optional fixed input), **Send events** to a bus and a **Test the pattern** tab. Like SNS subscriptions, a target gets a **Delivery** column (**delivers**, **needs permission** with a **Fix** button, **target missing**): the emulator delivers to a queue, function or topic only if its policy allows the rule, and **Allow this rule to deliver** adds that statement when a target is added.
- **Export and import for fixtures**: **Export** in the fixture editor and **Export all** on the Fixtures page save fixtures as JSON files that can be committed next to the code, and **Import** reads them back. Import shows what will happen first (new, renamed, replaced, skipped, not valid, problems found by **Check**), and a name that exists is saved as `name (2)`, replaces the existing fixture or is skipped. The console asks before it saves a file with values that may be secret (a secret, a secure parameter, function environment variables).
- **Add an assertion…** in the fixture editor: ready-made checks (a queue has N messages, a table has N items, an S3 object exists, a function is `Active`, a topic has N subscriptions, a secret exists) that are appended to the steps with suitable retries. The run results and History show how many checks hold (**2 of 3 assertions held**).
- **Copy as AWS CLI script** exports assertions as shell tests that retry like a replay and stop the script with `check failed: …` when one does not hold.
- **Assertions** in fixtures: a step with `expect` reads something and checks the response (`equals`, `notEquals`, `contains`, `exists`, `length`, `gt`/`gte`/`lt`/`lte`, `matches`), so a replay can confirm the state it built. A check that does not hold fails the step, and `retries` poll for state that arrives later (a function becoming `Active`). `{{variables}}` work in the expected values, **Check** validates the shape, and a failure never quotes the response of Secrets Manager, SSM or KMS.

### Changed

- The warning badge uses a darker amber (`--warning-text`) so its text passes contrast checks, and every code editor has an accessible name for screen readers.

## [0.4.0] - 2026-11-26

### Added

- The recorder links ids between steps: an id one call returned (an ARN, a queue URL, a key id) that a later call uses becomes a fixture variable, so a replay uses the id the new call returns. The Steps list shows **keeps** and **uses** per step, an unlink button undoes it, and a **Link ids** switch turns it off.
- A **Check** button in the fixture editor: it reads the steps without calling the emulator and reports unknown operations, missing or mistyped fields, variables nothing captures, steps that send again on every replay and deletes that undo a create. A failed run in the History has **Resume from step N**.
- **Fixture variables**: a step can keep values from its response (`capture`) and later steps use them as `{{name}}`, for ids the emulator makes up. A step that uses a variable nothing has set fails without calling the emulator, the history shows which names a step kept (never the values), and **Copy as AWS CLI script** turns them into shell variables.
- A pending SNS subscription (http, https, email, sms) shows its delete button disabled, with the reason, instead of no button at all: SNS cannot unsubscribe a pending subscription, so it is removed only by deleting the topic. The Subscribe dialog says so up front.
- The SNS Subscribe dialog checks `http` and `https` endpoints (the URL must start with the protocol's own scheme) and says what is wrong, instead of the emulator's `InvalidParameter: Endpoint`.
- A **Delivery** column on an SNS topic's subscriptions: **delivers**, **needs permission** (with a **Fix** button that adds the missing function or queue policy statement), **endpoint missing** or **unknown**, and a count in the tab title. Before, a Lambda or queue subscribed from the CLI or an SDK without the permission silently received nothing.
- **Copy as AWS CLI**: the operation runner copies the request as an `aws` command, and the recorder drawer and fixture editor copy a step, or all steps as a script (with a `sleep` where a replay pauses). The activity log still stores no inputs.

### Changed

- Bumped the AWS Emulator to 1.0.624.

### Fixed

- The restart recovery settings keep the saved **Replay automatically** choice when a baseline fixture is picked before the saved settings have loaded. Before, the switch stayed off, and saving would turn automatic replay off.
- The Lambda **Logs** tab no longer shows an empty extra run for a cold start on newer emulators, which write an `INIT_START` line before the first `START`.

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

[Unreleased]: https://github.com/Seelan-Tech/emulator-console/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Seelan-Tech/emulator-console/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Seelan-Tech/emulator-console/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Seelan-Tech/emulator-console/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Seelan-Tech/emulator-console/releases/tag/v0.1.0
