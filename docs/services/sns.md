# SNS

![An SNS topic](../images/sns-topic.png#gh-light-mode-only)
![An SNS topic](../images/sns-topic-dark.png#gh-dark-mode-only)

## Topics

**SNS** lists topics with their subscription counts and the number of pending confirmations. **Create topic** takes a name and a **FIFO** switch.

## Subscriptions

On a topic, **Subscriptions** lists who receives messages. **Subscribe** asks for a **Protocol** (`sqs`, `lambda`, `http`, `https`, `email` or `sms`) and an **Endpoint**. Only `sqs` and `lambda` subscriptions receive messages: the emulator never confirms the others (it sends no confirmation message), so they stay pending and nothing is delivered to them. The dialog marks them as "will not deliver".

When the protocol is `sqs` (or `lambda`) you pick one of your queues (or functions) from a list. These switches matter:

- **Allow topic in queue policy** (queues) adds the policy statement that lets this topic send to that queue. Without it SNS cannot deliver, and nothing tells you so. Leave it on unless you manage the queue policy yourself.
- **Allow this topic to invoke the function** (functions) adds a `lambda:InvokeFunction` permission for `sns.amazonaws.com`, limited to this topic, with the statement id `sns-<region>-<topic>`. Without it the function never runs and no log group appears. Leave it on unless you manage the function's policy yourself; a topic that was already allowed is fine. A subscription made with the AWS CLI or an SDK needs `lambda add-permission` by hand.
- **Raw message delivery** delivers the message body as it was published, instead of wrapped in the SNS JSON envelope.

### Health

The **Health** column checks that each subscription can actually deliver, which SNS never tells you. For `sqs` it reads the queue's policy and for `lambda` the function's resource policy, and looks for a statement that lets this topic in (a matching `aws:SourceArn` condition, or none). A missing queue or function, or a policy without the topic, shows as **broken**, and **Fix** adds the same statement the Subscribe dialog would have added. Subscriptions that stay pending, and protocols the emulator never delivers to, show as warnings. **Recheck health** reads the targets again; the checks run one at a time because the emulator drops connections under bursts.

## Publishing

**Publish** takes a **Message**, optional **Message attributes** and, for FIFO topics, a **Message group id**. The result shows the message id. If a queue is subscribed you can see the delivery on the queue's [Receive tab](sqs.md#receiving).
