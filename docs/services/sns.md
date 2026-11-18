# SNS

![An SNS topic](../images/sns-topic.png#gh-light-mode-only)
![An SNS topic](../images/sns-topic-dark.png#gh-dark-mode-only)

## Topics

**SNS** lists topics with their subscription counts and the number of pending confirmations. **Create topic** takes a name and a **FIFO** switch.

## Subscriptions

On a topic, **Subscriptions** lists who receives messages. **Subscribe** asks for a **Protocol** (`sqs`, `lambda`, `http`, `https`, `email` or `sms`) and an **Endpoint**. Only `sqs` and `lambda` subscriptions receive messages: the emulator never confirms the others (it sends no confirmation message), so they stay pending and nothing is delivered to them. The dialog marks them as "will not deliver". An `http` subscription takes an `http://` URL and an `https` one an `https://` URL (SNS rejects anything else with `InvalidParameter: Endpoint`); the dialog says what is wrong with the URL and trims stray spaces.

When the protocol is `sqs` (or `lambda`) you pick one of your queues (or functions) from a list. These switches matter:

- **Allow topic in queue policy** (queues) adds the policy statement that lets this topic send to that queue. Without it SNS cannot deliver, and nothing tells you so. Leave it on unless you manage the queue policy yourself.
- **Allow this topic to invoke the function** (functions) adds a `lambda:InvokeFunction` permission for `sns.amazonaws.com`, limited to this topic, with the statement id `sns-<region>-<topic>`. Without it the function never runs and no log group appears. Leave it on unless you manage the function's policy yourself; a topic that was already allowed is fine. A subscription made with the AWS CLI or an SDK needs `lambda add-permission` by hand, or **Fix** below.
- **Raw message delivery** delivers the message body as it was published, instead of wrapped in the SNS JSON envelope.

The **Delivery** column checks, for each `sqs` and `lambda` subscription, whether the endpoint will actually receive from this topic:

- **delivers**: the function's or queue's policy allows this topic.
- **needs permission**: the endpoint exists but does not allow this topic (typical for a subscription made with the CLI or an SDK), so nothing is delivered and nothing says why. **Fix** adds the same statement the Subscribe dialog would. The tab title counts these: `Subscriptions (3, 1 needs attention)`.
- **endpoint missing**: the function or queue does not exist.
- **unknown**: the check itself failed.

The check reads the endpoint's policy when the tab opens, one endpoint at a time; a statement that names a different topic does not count, and one with no source condition allows any topic. It does not look at message filtering, FIFO deduplication or a function that errors.

## Publishing

**Publish** takes a **Message**, optional **Message attributes** and, for FIFO topics, a **Message group id**. The result shows the message id. If a queue is subscribed you can see the delivery on the queue's [Receive tab](sqs.md#receiving).
