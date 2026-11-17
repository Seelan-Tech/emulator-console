# SNS

![An SNS topic](../images/sns-topic.png#gh-light-mode-only)
![An SNS topic](../images/sns-topic-dark.png#gh-dark-mode-only)

## Topics

**SNS** lists topics with their subscription counts and the number of pending confirmations. **Create topic** takes a name and a **FIFO** switch.

## Subscriptions

On a topic, **Subscriptions** lists who receives messages. **Subscribe** asks for a **Protocol** (`sqs`, `lambda`, `http`, `https`, `email` or `sms`) and an **Endpoint**. Only `sqs` and `lambda` subscriptions receive messages: the emulator never confirms the others (it sends no confirmation message), so they stay pending and nothing is delivered to them. The dialog marks them as "will not deliver".

When the protocol is `sqs` (or `lambda`) you pick one of your queues (or functions) from a list. Two switches matter:

- **Allow topic in queue policy** adds the policy statement that lets this topic send to that queue. Without it SNS cannot deliver, and nothing tells you so. Leave it on unless you manage the queue policy yourself.
- **Raw message delivery** delivers the message body as it was published, instead of wrapped in the SNS JSON envelope.

## Publishing

**Publish** takes a **Message**, optional **Message attributes** and, for FIFO topics, a **Message group id**. The result shows the message id. If a queue is subscribed you can see the delivery on the queue's [Receive tab](sqs.md#receiving).
