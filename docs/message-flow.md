# Message flow

Since 0.5.0. **Message flow**, at the top of a target's sidebar (or **Go to** in the [command palette](command-palette.md)), draws how messages move between the services you have: which topics deliver to which queues and functions, which queues trigger which functions, and which queues are dead-letter queues of others.

## Reading the diagram

Columns run from sources on the left to consumers on the right. A box is a resource, and clicking it opens its screen. A line says what the connection does, in words as well as colour:

| Line | Meaning |
| --- | --- |
| **delivers** (solid green) | An SNS subscription to a queue or function that allows this topic: messages arrive. |
| **needs permission** (dashed amber) | The queue or function exists, but its policy does not allow this topic, so nothing is delivered and nothing says why. This is the same check as the [Delivery column](services/sns.md#subscriptions); fix it from the topic. |
| **endpoint missing** (dashed red) | The subscription points at a queue or function that does not exist (or is in another region). |
| **will not deliver** | An `http`, `https`, `email` or `sms` subscription. The emulator never confirms these. |
| **pending confirmation** | A subscription that has not been confirmed. |
| **triggers** | A Lambda event source mapping: the queue (or stream) invokes the function. A mapping that is not `Enabled` says so. |
| **dead letters** (dashed grey) | The queue's redrive policy sends failed messages to this queue. |

A dashed box is something a connection names but this region does not have. A queue shows how many messages are waiting, in flight or delayed.

Resources with no connection are listed under **Not connected** instead of being drawn, so they do not push the connected ones aside. Below the diagram, **Connections** lists the same lines as a table: use it for a screen reader, or to copy a name.

## What it reads

Topics and their subscriptions, queues (their attributes, redrive policy and policy), functions and event source mappings of the region chosen in the header, one call at a time (the emulator drops connections under parallel bursts). A service that does not answer is named in a warning, and the rest is still drawn. **Refresh** reads again; the page does not poll.

It does not follow EventBridge rules, Step Functions or anything a function does when it runs, and it does not look at message filtering or FIFO deduplication.
