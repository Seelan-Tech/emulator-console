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

### Ids between steps

Since 0.4.0. When a call returns an id and a later call uses it, the recorder turns it into a [variable](#variables): the first step gets a `capture` and the later one `{{name}}`, so a replay uses the id the new call returns, not the one that was typed in. The **Steps** list marks the steps with **keeps queueUrl** and **uses queueUrl**; the **×** on **uses …** puts the value itself back. Removing a step that returned an id does the same for the steps that used it. The **Link ids** switch next to **Record** turns this off (it is on by default).

Only values shaped like an id the emulator makes up are linked, so that things that merely look alike are not tied together: ARNs, `http(s)://` URLs (queue URLs), UUIDs (KMS key ids), prefixed hex ids (`i-…`, `vpc-…`, `sg-…`) and long upper-case ids (IAM ids). A name you typed yourself, such as a bucket or queue name, is never linked, and neither is an id that two different earlier steps returned (it is not clear which one was meant). The id is replaced wherever it appears in a later step, also inside longer text such as a queue policy.

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
| `capture` | Optional. Values to keep from the response for later steps: see [Variables](#variables). |
| `expect` | Optional. Checks on the response, which make the step an [assertion](#assertions). |

A fixture holds at most 500 steps. The editor reports invalid JSON before saving.

### Variables

Since 0.4.0. A step can keep values from its response, and later steps can use them. This is for ids the emulator makes up (a KMS key id, an EC2 or IAM id, an execution ARN), and for replaying on a target whose port or region differs, where a queue URL is not the same.

```json
[
  {
    "service": "kms",
    "operation": "CreateKey",
    "input": {},
    "capture": { "keyId": "KeyMetadata.KeyId" }
  },
  {
    "service": "kms",
    "operation": "CreateAlias",
    "input": { "AliasName": "alias/app", "TargetKeyId": "{{keyId}}" }
  }
]
```

- `capture` maps a variable name (letters, digits and `_`, not starting with a digit) to a path in the response: `Attributes.QueueArn`, `Subnets[0].SubnetId`.
- `{{name}}` can be used in any string of a later step's `input`. A string that is exactly `{{name}}` becomes the value itself, so numbers and lists keep their type; inside longer text the value is written as text.
- A step that uses a name no earlier step has set fails without calling the emulator. A path that matches nothing fails the step, and it is not retried, because the call already went through.
- Variables last for one run. The **History** shows the names a step kept (**kept keyId**), never the values, like step outputs.
- **Copy as AWS CLI script** turns a capture into a shell variable (`read -r keyId <<<"$(aws … --query '[KeyMetadata.KeyId]' --output text)"`) and the references into `"$keyId"`. A reference inside a Lambda `Invoke` payload is not substituted in the script.

### Assertions

Since 0.5.0. A step with `expect` is an assertion: it makes a read call, then checks the response. A fixture can say what the state should be, not only how to build it, so a replay doubles as a smoke test.

```json
{
  "service": "sqs",
  "operation": "GetQueueAttributes",
  "input": { "QueueUrl": "{{queueUrl}}", "AttributeNames": ["ApproximateNumberOfMessages"] },
  "retries": 5,
  "retryDelayMs": 1000,
  "expect": [{ "path": "Attributes.ApproximateNumberOfMessages", "equals": "0" }]
}
```

Each check has a `path` into the response (as in [`capture`](#variables)) and exactly one matcher:

| Matcher | Holds when the value at `path` |
| --- | --- |
| `equals` / `notEquals` | is (is not) deeply equal to the given value. Strict: the text `"3"` is not the number `3`. |
| `contains` | is a text that includes the given text, or a list with the given item |
| `exists` | has a value (`true`), or has none (`false`) |
| `length` | is a list or text of that length, or an object with that many keys |
| `gt`, `gte`, `lt`, `lte` | compares with a number. A number that came back as text, like an SQS attribute, counts. |
| `matches` | a text or number that matches the regular expression |

- A step has up to 20 checks, and all of them have to hold. `{{name}}` works in the expected values, so a check can compare with an id an earlier step [kept](#variables).
- A check that does not hold fails the step. `retries` and `retryDelayMs` apply, so "the function becomes `Active` within a few seconds" is a step with `retries`, not a fixed pause. Use a read operation: a check that is retried runs the call again, and **Check** warns about one that changes state.
- The failure says what was expected and what the response held (`Attributes.ApproximateNumberOfMessages: expected "0", got "2"`), cut to 120 characters. For `secretsmanager`, `ssm` and `kms` it never quotes the response. The History shows it like any failed step.
- **Continue after a failed step** goes on after a failed assertion too, and the run still ends as failed.

#### Adding an assertion

Since 0.5.0. Under the steps, **Add an assertion…** offers ready-made ones: a queue has N messages, a table has N items, an S3 object exists, a Lambda function is `Active`, an SNS topic has N subscriptions, a secret exists. Choose one, fill in the names (a `{{variable}}` works for an id an earlier step kept) and **Add to steps** appends it, with `retries` that suit it, to the end of the JSON. **Save** keeps it. A template is only a starting point: edit the JSON to change the check.

#### In the history

A step with checks shows how many hold (**2 checks hold**) or how many failed, and a run says **2 of 3 assertions held**. A run that stopped at a failed step counts only the assertions that ran.

#### As an AWS CLI script

**Copy as AWS CLI script** turns an assertion into shell: the read is repeated as often as `retries` says, and the script stops with `check failed: sqs.GetQueueAttributes` when a check does not hold, so a script can verify what a fixture built. `equals` and `notEquals` on text, numbers and booleans, `exists`, `length`, `gt`, `gte`, `lt`, `lte` and `contains` on plain text are exported (`gt` and the others need `awk`). `matches`, and `equals` or `contains` on a list or object, are not: the script says so in a comment, because shell patterns differ from JavaScript ones.

### Checking a fixture

Since 0.4.0. **Check**, next to **Save**, reads the steps as they are typed in the editor, saved or not, and lists what is wrong. It never calls the emulator or a target.

- **Errors**: a step that is not valid, an operation the service does not have, a required field that is missing, a field of the wrong kind (a number where a string is expected), and a `{{name}}` that no earlier step captures (or that a later step captures), also inside an [assertion](#assertions), whose shape is checked as well (a check needs a path and exactly one matcher, and a pattern has to be valid).
- **Warnings**: a field the operation does not have (the SDK ignores it, which is usually a typo), a step that sends again on every replay (`SendMessage`, `Publish`, `PutEvents`, `PutRecord`, `StartExecution`), a `Delete…` that undoes an earlier `Create…` of the same thing, and an assertion on an operation that changes state. The `Delete…` match is a best-effort match on the fields the delete names.

A value that is a `{{name}}` is not judged, because it is only known during the replay. The check cannot tell whether a resource already exists on a target.

## Replaying

In the editor, **Replay on a target** picks a target and **Save & run** executes the steps in order, saving any edits first.

- A step that fails stops the run, unless **Continue after a failed step** is ticked.
- The **History** shows every run: which target, when, the result, and per step the outcome, time and attempts. A run started by a restart is marked **after restart**.
- Step outputs are not stored.
- Since 0.4.0, a failed run has **Resume from step N** in the History. It runs the fixture again from the step that failed, on the target chosen under **Replay on a target**, and saves the editor first. The steps before it are not run again, except steps that [keep a value](#variables) a later step uses, since that value is gone: the button's tooltip names them. The run's results number the steps as in the fixture. If you edited the steps since the failed run, the step numbers may no longer match.

Replaying calls the API again; it does not restore state. A step that depends on an id returned by an earlier step can [keep it in a variable](#variables). The recorder [adds them](#ids-between-steps) for ids that one call returns and a later one uses.

Every recorded step runs, in order, including ones that undo each other: a bucket you created and later deleted is created and deleted again. A recorded `SendMessage` or `Publish` is sent again. Right after a restart the emulator may still refuse a step, for example when a queue name was deleted less than 60 seconds ago; use a step's retry settings or run the fixture again.

## Baseline fixture and automatic replay

Open the target's settings (the gear in the header, or **Choose a baseline** in the restart banner). Choose a **Baseline fixture**, and switch on **Replay automatically after a restart** if you want it hands-free. See [Restart recovery](concepts.md#restart-recovery) for what the banner does. Automatic replay needs a target that reads the emulator's credential files.

![Restart settings](images/restart-banner.png#gh-light-mode-only)
![Restart settings](images/restart-banner-dark.png#gh-dark-mode-only)
