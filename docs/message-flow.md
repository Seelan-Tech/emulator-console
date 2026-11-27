# Message flow

Since 0.5.0. **Message flow**, at the top of a target's sidebar (or **Go to** in the [command palette](command-palette.md)), draws how messages move between the services you have: which topics deliver to which queues and functions, which queues trigger which functions, which queues are dead-letter queues of others, and which rules send events from an event bus to what.

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
| a **rule's name** (an [EventBridge](services/eventbridge.md) rule) | A line from an event bus to one of the rule's targets. Its colour is the same delivery check as the target's **Delivery** column: green delivers, dashed amber needs permission, dashed red target missing, grey not checked (a target that is not a queue, function or topic). A rule that is switched off is grey and says **off**. The line itself is the rule's name, shortened; hover it for the full words, and the table below has them. |

A dashed box is something a connection names but this region does not have. An event bus is drawn once it has a rule; a bus whose rules have no target is listed under **Not connected**, and two rules that send to the same target are drawn as two lines. A rule can also send to another bus. A queue shows how many messages are waiting, in flight or delayed.

Resources with no connection are listed under **Not connected** instead of being drawn, so they do not push the connected ones aside. Below the diagram, **Connections** lists the same lines as a table: use it for a screen reader, or to copy a name.

## What it reads

Topics and their subscriptions, queues (their attributes, redrive policy and policy), functions, event source mappings, and event buses with their rules and targets, of the region chosen in the header, one call at a time (the emulator drops connections under parallel bursts). A service that does not answer is named in a warning, and the rest is still drawn. **Refresh** reads again; the page does not poll.

It does not follow Step Functions, Kinesis streams as sources, EventBridge archives or API destinations, or anything a function does when it runs, and it does not look at message filtering, FIFO deduplication or whether an event pattern matches anything.
