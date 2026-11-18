# Lambda

![A Lambda function](../images/lambda-function.png#gh-light-mode-only)
![A Lambda function](../images/lambda-function-dark.png#gh-dark-mode-only)

## Functions

**Lambda** lists functions with their runtime and **State**. A new or updated function is **Pending** for a few seconds and then **Active**; the list refreshes itself, and the emulator rejects invocations until the function is active.

**Create function** takes a **Function name**, a **Runtime** (Python 3.12 or 3.13, Node.js 20 or 22), a **Handler**, **Memory**, **Timeout** and a **Role ARN** that defaults to a placeholder. The editor starts with a working handler that changes with the runtime. You can write the code inline or upload a **.zip** instead.

## Code

The **Code** tab edits the handler source for inline functions and saves it with **Update code**. A recorded code update is stored as base64, so fixtures that contain zips can be large.

## Configuration

**Configuration** edits the **Handler**, **Memory**, **Timeout** and environment variables (as JSON) and saves with **Save configuration**. Invalid JSON is reported before anything is sent.

## Regions

On this emulator a function is listed (and can be invoked) from every region; its ARN keeps the region it was created in. SNS topics and SQS queues are per region, so the permission that lets a topic invoke a function must name the topic's own ARN, region included (the SNS subscribe dialog does this for you).

## Invoking

Write a **Test event** (JSON) and press **Invoke**. The **Response** shows the status code, the returned payload and, because the console asks for the execution log, the function's **Log** output. A function that raises an error shows the error type and message, with the status of the invocation. The emulator really runs your code.

**Save event** keeps a test event in your browser so you can load it again from **Saved events**; **Clear saved events** forgets them. Invocations are never recorded.

## Logs

The **Logs** tab lists the recent runs of the function, newest first, whoever started them: the **Invoke** tab, the AWS CLI or an SDK, or an SNS subscription. The emulator writes every run to the function's log group (`/aws/lambda/<function name>`), and the tab reads it. Each run shows its time, request id, status (**ok**, **error**, or **running** until its report line arrives), duration and memory; open it to see what the function printed. An error is the runtime's own failure line (an exception, a timeout); a plain `console.error` or `logging.error` in your code does not mark a run as failed. Printed JSON (an event, a payload) is spread over several lines; switch **Format JSON** off to see the raw lines. Only JSON is formatted: a Python `print(event)` writes a dict with single quotes, so use `print(json.dumps(event))` to get it formatted.

Choose a time window (15 minutes, an hour or 24 hours), **Refresh**, or switch on **Auto-refresh**. Logs can lag a run by a few seconds, and a function that has never run has no log group yet ("No runs yet"). Deleting a function leaves its log group behind, as in AWS; remove it with `logs.DeleteLogGroup` in the [operation runner](other-services.md) if you want it gone.
