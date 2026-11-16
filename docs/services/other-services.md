# Everything else: the operation runner

![The operation list for a service](../images/operations.png#gh-light-mode-only)
![The operation list for a service](../images/operations-dark.png#gh-dark-mode-only)

Every service the emulator supports is in the sidebar: EventBridge, Kinesis, Step Functions, EC2, KMS, IAM, STS, SSM, CloudWatch Logs and CloudFormation, plus the six with their own screens. Choosing a service without a screen opens its **All operations** list; **Search operations** narrows it (the [command palette](../command-palette.md) can jump straight to any operation too).

## Running an operation

Pick an operation and the console shows a form built from the SDK's own schema for it. Required fields are marked, and optional ones are tucked under **Optional fields**.

![A generated form](../images/operation-form.png#gh-light-mode-only)
![A generated form](../images/operation-form-dark.png#gh-dark-mode-only)

- **Form** and **JSON** are two views of the same request. Edit either; the other follows.
- Lists have **Add item** and **Remove**. Maps have key and value rows. Nested structures nest.
- Binary fields accept `{"$base64": "…"}` in the JSON view.
- Shapes that cannot be modelled (recursive ones such as a DynamoDB attribute value) are a free-form JSON box instead.

Press **Run**. The response appears below as JSON, with the time taken. AWS errors show their name and message, so `NoSuchBucket` reads as `NoSuchBucket`, not as "request failed".

## Recording

State-changing operations run here are recorded like any other action, so a one-off `ssm.PutParameter` becomes part of your next fixture. Reads are not.

## Regions

The region picker in the header applies to every call, including these.
