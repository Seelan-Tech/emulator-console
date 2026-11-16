# SQS

![An SQS queue](../images/sqs-queue.png#gh-light-mode-only)
![An SQS queue](../images/sqs-queue-dark.png#gh-dark-mode-only)

## Queues

**SQS** lists queues with their message counts: **Available**, **In flight** and **Delayed**. **Auto-refresh** keeps the counts live. **Create queue** takes a name, a **FIFO** switch (the `.fifo` suffix is added for you) and a visibility timeout (0 to 900 seconds).

Deleting a queue asks for its name. The emulator will not let you create a queue with the name of one you just deleted for **60 seconds**; the console shows the emulator's message when that happens.

## Sending

On a queue, the **Send** tab takes a **Message body** (a code editor, so JSON stays readable), optional **Message attributes** (name, type and value) and, for FIFO queues, a **Message group id**. A FIFO queue without a group id fails with a clear message before anything is sent.

## Receiving

The **Receive** tab polls the queue.

- **Peek** (on by default) looks at messages without hiding them from other consumers, so you can inspect a queue without disturbing it.
- With Peek off, **Poll** really receives: messages become _in flight_ for the visibility timeout, and you can **delete** them one at a time or in bulk.
- **Max messages** sets how many to fetch (1 to 10).

Receiving and deleting messages are never recorded as fixture steps, because a receipt handle cannot be replayed.

## Purge

**Purge** removes every message in the queue after a confirmation.

## More

Attributes, tags and redrive policies are in the [operation runner](other-services.md).
