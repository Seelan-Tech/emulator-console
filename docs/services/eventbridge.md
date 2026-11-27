# EventBridge

Since 0.5.0. **EventBridge** has its own screens: event buses, the rules on a bus, and each rule's targets.

## Event buses

**EventBridge** lists the buses with their rule counts. Every target has a **default** bus, which cannot be deleted. **Create event bus** takes a name (letters, digits, dots, hyphens and underscores). EventBridge refuses to delete a bus that still has rules, so delete them first.

## Rules

Open a bus to see its **Rules**: the name, an **Enabled** switch, what the rule **fires on** (its pattern on one line, or its schedule) and how many targets it has.

**Create rule** asks for a name, an optional description, what it fires on and whether it is enabled:

- **An event pattern** is a JSON object that an event has to match, for example `{"source": ["my.app"], "detail-type": ["order.created"]}`. **Start from an example…** fills in a few common shapes. The dialog says what is wrong with the JSON before you send it.
- **A schedule** is `rate(5 minutes)` (the unit is singular for 1: `rate(1 hour)`) or a six-field `cron(0 12 * * ? *)`. AWS runs scheduled rules only on the default bus; the emulator may accept one on another bus, and the dialog says so.

Creating a rule opens it so you can add targets. **Edit** on a rule replaces it as a whole (this is how `PutRule` works), so the dialog shows all of its fields.

**Delete** removes the rule's targets first, because EventBridge refuses to delete a rule that has any.

## Targets and delivery

On a rule, **Add target** picks a queue, a function or a topic from your own resources (or any other ARN). An optional **fixed input** replaces the event with that JSON.

EventBridge delivers to a queue, function or topic **only if its policy allows the rule**. The emulator behaves like AWS here: without the permission, nothing is delivered and nothing says so. So:

- **Allow this rule to deliver** (on by default when you add a target) adds the statement: a queue or topic policy statement for `events.amazonaws.com` limited to this rule, or a Lambda permission with the statement id `events-<bus>-<rule>`. A statement for the same rule is replaced, never duplicated, and the rest of a policy is kept.
- The **Delivery** column checks it for every queue, function and topic target, one at a time, when the tab opens: **delivers**, **needs permission** (with a **Fix** button that adds the statement), **target missing**, **unknown** (the check failed) or **not checked** (another kind of target). The tab title counts the targets that need attention.

The check reads the target's policy. It does not look at a function that errors, a FIFO queue's group id or a dead-letter queue.

## Sending events and testing a pattern

**Send events** on a bus puts one event (a source, a detail type and a JSON detail) on it. A queue target receives the event as EventBridge wraps it: `version`, `id`, `detail-type`, `source`, `account`, `time`, `region`, `resources` and `detail`. The emulator accepts an event for a bus that does not exist, so check the bus name.

**Test the pattern** on a rule checks an event against the rule's pattern without sending anything. It starts from a sample event built from the pattern's plain values, and shows **matches** or **does not match**.

## In the message flow

The [message flow](../message-flow.md) page draws each rule as a line from its bus to its targets, with the same delivery check, so you can see at a glance which rules deliver and which still need a permission.

## What it does not cover

Archives, replays, API destinations, connections, schemas, input transformers, dead-letter queues on a target, cross-account buses and event bus policies are not on these screens. [All operations](other-services.md) can call any of them.
