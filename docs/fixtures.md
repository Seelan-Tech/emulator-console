# Fixtures and replay

A fixture is a recipe for rebuilding state: an ordered list of API calls. Fixtures are how you get a restarted emulator back to a known state, and how a team shares "the setup our tests expect".

![The fixtures list](images/fixtures.png#gh-light-mode-only)
![The fixtures list](images/fixtures-dark.png#gh-dark-mode-only)

## Recording

1. Check that **Record** is on in the bar at the bottom of the page (it is by default).
2. Do things in the console: create a bucket, a table, a queue, put an item, deploy a function.
3. The counter shows **N steps**. **Steps** expands the list, where an entry can be removed with its **×**.
4. **Save as fixture**: either **New fixture…** (give it a name) or append to an existing one.

![The recorder drawer](images/recorder.png#gh-light-mode-only)
![The recorder drawer](images/recorder-dark.png#gh-dark-mode-only)

What is recorded: successful state-changing calls from the screens and from the operation runner. What is not: reads, Lambda `Invoke`, receiving or deleting SQS messages, S3 uploads, and anything done with the AWS CLI.

### What a fixture cannot capture

Recording happens in the console, in your browser, so only what you do in the console is seen. Calls made with the AWS CLI, an SDK or a script go straight to the emulator, which has no API that lists or logs what it holds, so there is nothing for the console to read back. Setup done that way is **not in the fixture**, and a replay will not rebuild it.

To get it into a fixture, repeat it in the console while **Record** is on, or add the steps by hand in the editor (fixtures are plain JSON). The other direction works: **Copy steps as AWS CLI script** in the recorder drawer (or **Copy as AWS CLI script** in the fixture editor) turns recorded steps into a shell script of `aws` commands, with a `sleep` where a replay pauses, and the **Steps** list has a button per step. Inputs are never kept in the [activity log](concepts.md), so those copies come from the recorder, the editor and the runner only. S3 uploads are not recorded either, so a replay recreates a bucket but not the files in it.

The recorder adds the pauses and retries that make a replay reliable, because the emulator makes some resources usable only after a moment:

| Operation | Added |
| --- | --- |
| `dynamodb.CreateTable` | 3 s pause afterwards |
| `lambda.CreateFunction` | 5 s pause afterwards |
| `lambda.UpdateFunctionCode` | 4 s pause afterwards |
| `PutItem`, `UpdateItem`, `BatchWriteItem` | up to 5 retries (the table may still be `CREATING`) |

## The fixture editor

**Fixtures** lists them with their step counts; opening one shows its description and its **Steps** as JSON.

![The fixture editor](images/fixture-editor.png#gh-light-mode-only)
![The fixture editor](images/fixture-editor-dark.png#gh-dark-mode-only)

Each step is an object:

```json
{
  "service": "dynamodb",
  "operation": "CreateTable",
  "input": { "TableName": "orders", "BillingMode": "PAY_PER_REQUEST" },
  "region": "us-east-1",
  "delayAfterMs": 3000,
  "retries": 0,
  "retryDelayMs": 1000
}
```

| Field | Meaning |
| --- | --- |
| `service` | One of the 16 service ids: `s3`, `dynamodb`, `sqs`, `sns`, `lambda`, `secretsmanager`, `ssm`, `kms`, `iam`, `sts`, `ec2`, `eventbridge`, `kinesis`, `sfn`, `logs`, `cloudformation`. |
| `operation` | The API operation name, for example `PutObject`. |
| `input` | The operation's request, exactly as in the [operation runner](services/other-services.md). Binary values are `{"$base64": "…"}`. |
| `region` | Optional; defaults to the target's region. |
| `delayAfterMs` | Pause after the step, 0 to 60 000. |
| `retries` | Extra attempts if the step fails, 0 to 20. |
| `retryDelayMs` | Wait between attempts, 100 to 30 000. |

A fixture holds at most 500 steps. The editor reports invalid JSON before saving.

## Replaying

In the editor, **Replay on a target** picks a target and **Save & run** executes the steps in order, saving any edits first.

- A step that fails stops the run, unless **Continue after a failed step** is ticked.
- The **History** shows every run: which target, when, the result, and per step the outcome, time and attempts. A run started by a restart is marked **after restart**.
- Step outputs are not stored.

Replaying calls the API again; it does not restore state. A step that depends on an id returned by an earlier step (a queue URL, say) needs editing by hand to use a name you control.

Every recorded step runs, in order, including ones that undo each other: a bucket you created and later deleted is created and deleted again. A recorded `SendMessage` or `Publish` is sent again. Right after a restart the emulator may still refuse a step, for example when a queue name was deleted less than 60 seconds ago; use a step's retry settings or run the fixture again.

## Baseline fixture and automatic replay

Open the target's settings (the gear in the header, or **Choose a baseline** in the restart banner). Choose a **Baseline fixture**, and switch on **Replay automatically after a restart** if you want it hands-free. See [Restart recovery](concepts.md#restart-recovery) for what the banner does. Automatic replay needs a target that reads the emulator's credential files.

![Restart settings](images/restart-banner.png#gh-light-mode-only)
![Restart settings](images/restart-banner-dark.png#gh-dark-mode-only)
