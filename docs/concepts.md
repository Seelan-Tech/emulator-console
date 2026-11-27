# Concepts

## Targets

A **target** is one emulator endpoint the console talks to: a URL, a region and credentials. The **Targets** page lists them; **Add a target** creates one. For a target that reads the emulator's own credential files, the list and the target header also show which emulator build is running (for example `Emulator 1.0.385`); hover for the release date and commit. The emulator image records this next to its credentials when it starts, so an emulator started from an older image shows no version until it is rebuilt and restarted.

![The targets page](images/targets.png#gh-light-mode-only)
![The targets page](images/targets-dark.png#gh-dark-mode-only)

| Field          | Meaning                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint URL   | Where the emulator listens, for example `https://emulator:9297`.           |
| Region         | The default region for calls. You can switch region per target in the header; the choice is remembered.                                                              |
| Credentials    | Either an **access key id and secret** (the secret is stored encrypted), or **read from the emulator's credential files** in a directory under the credentials root. |
| Verify TLS as  | The emulator's certificate is only valid for `localhost`, so a target that connects to `emulator:9297` verifies the certificate as `localhost`.                      |
| CA certificate | The emulator's private CA, when it is not read from files.                                                                                                           |

**Credential files** mode is what the Compose stack uses. The console re-reads the files when they change, so a restarted emulator with new keys keeps working, and it can tell _that_ the emulator restarted ([restart recovery](#restart-recovery)).

The **overview** of a target shows whether it is connected and which services the emulator implements.

## Services and operations

The seven services with their own screens are [S3](services/s3.md), [DynamoDB](services/dynamodb.md), [SQS](services/sqs.md), [Lambda](services/lambda.md), [SNS](services/sns.md), [EventBridge](services/eventbridge.md) and [Secrets Manager](services/secrets-manager.md). Every operation of all 16 supported services can be run from the [operation runner](services/other-services.md), whose forms are generated from the AWS SDK itself, so they always match the API.

## The recorder

Every target page has a bar at the bottom with a **Record** switch and a step counter. While it is on, each **state-changing** call you make in the console is added as a step. Reads, Lambda invocations and message receipts are never recorded, because replaying them would change nothing or cannot work.

The recorder keeps its steps in your browser, per target, so they survive a page reload. Press **Save as fixture** to turn them into a fixture, or **Clear** to start over. See [Fixtures and replay](fixtures.md).

## Fixtures

A **fixture** is a named list of steps: an operation, its input and optionally a region, a pause after it and a retry policy. Replaying a fixture runs the steps in order against a target. Fixtures are plain JSON, so you can edit them in the console or keep them in version control.

## Restart recovery

The emulator forgets everything when it restarts. For a target that reads the emulator's credential files, the console fingerprints the access key (the emulator regenerates it on every start) and checks it every few seconds. When it changes:

1. A **banner** appears on every page of that target.
2. If the target has a **baseline fixture** and **automatic replay** is on, the console waits for the emulator to answer and replays the baseline. The banner shows progress and then "state restored", or the step that failed.
3. Otherwise the banner offers **Replay "<baseline>"**, or **Choose a baseline** if there is none yet.

A target with static credentials cannot detect restarts, because its keys never change from the console's point of view. You can still replay the baseline by hand.

## Activity log

The **Activity** page shows what changed and when: service, operation, target, outcome and duration. It opens on **Changes only**; switch to **All calls** to include reads, and filter by target. The log never stores request inputs, so it cannot leak a secret you typed.

![The activity log](images/activity.png#gh-light-mode-only)
![The activity log](images/activity-dark.png#gh-dark-mode-only)
