import assert from "node:assert/strict";

import { test } from "vitest";

import { groupInvocations, type LogEvent } from "./logs";

const ev = (t: number, message: string, logStreamName = "s1"): LogEvent => ({ timestamp: t, message, logStreamName });

// Shapes captured from the emulator (Python runtime).
const okRun = (id: string, t: number, stream: string): LogEvent[] => [
  ev(t, `START RequestId: ${id} Version: $LATEST`, stream),
  ev(t + 1, "line one", stream),
  ev(t + 2, "line two", stream),
  ev(t + 3, `END RequestId: ${id}`, stream),
  ev(
    t + 4,
    `REPORT RequestId: ${id}\tDuration: 398.58 ms\tBilled Duration: 399 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB`,
    stream,
  ),
];

test("a normal run: output lines and the REPORT figures", () => {
  const [inv, ...rest] = groupInvocations(okRun("aaa", 100, "s1"));
  assert.equal(rest.length, 0);
  assert.deepEqual(inv, {
    requestId: "aaa",
    startedAt: 100,
    lines: ["line one", "line two"],
    status: "ok",
    durationMs: 398.58,
    billedMs: 399,
    memorySizeMb: 128,
    memoryUsedMb: 1,
  });
});

test("an unhandled error is flagged with its message, and the traceback stays in the output", () => {
  const [inv] = groupInvocations([
    ev(1, "START RequestId: bbb Version: $LATEST"),
    ev(2, "[ERROR] ValueError: boom"),
    ev(3, "Traceback (most recent call last):"),
    ev(4, '  File "/var/task/index.py", line 7, in handler'),
    ev(5, "END RequestId: bbb"),
    ev(
      6,
      "REPORT RequestId: bbb\tDuration: 9.52 ms\tBilled Duration: 10 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB",
    ),
  ]);
  assert.equal(inv!.status, "error");
  assert.equal(inv!.error, "ValueError: boom");
  assert.equal(inv!.lines.length, 3);
});

test("a timeout is an error too", () => {
  const [inv] = groupInvocations([
    ev(1, "START RequestId: ccc Version: $LATEST"),
    ev(2, "[ERROR] RuntimeError: the invocation ran past its timeout"),
    ev(3, "END RequestId: ccc"),
    ev(
      4,
      "REPORT RequestId: ccc\tDuration: 2019.03 ms\tBilled Duration: 2020 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB",
    ),
  ]);
  assert.equal(inv!.status, "error");
  assert.equal(inv!.durationMs, 2019.03);
});

test("a run without a REPORT yet is still running", () => {
  const [inv] = groupInvocations([ev(1, "START RequestId: ddd Version: $LATEST"), ev(2, "working")]);
  assert.equal(inv!.status, "running");
  assert.deepEqual(inv!.lines, ["working"]);
});

test("runs from several streams are separated and listed newest first, whatever order the events arrive in", () => {
  const events = [...okRun("old", 100, "s1"), ...okRun("new", 500, "s2")].reverse();
  assert.deepEqual(
    groupInvocations(events).map((i) => i.requestId),
    ["new", "old"],
  );
});

test("interleaved runs in one stream keep their own lines (matched by request id)", () => {
  const out = groupInvocations([
    ev(1, "START RequestId: a Version: $LATEST"),
    ev(2, "from a"),
    ev(3, "END RequestId: a"),
    ev(4, "REPORT RequestId: a\tDuration: 1.00 ms\tBilled Duration: 1 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB"),
    ev(5, "START RequestId: b Version: $LATEST"),
    ev(6, "from b"),
  ]);
  assert.deepEqual(
    out.map((i) => [i.requestId, i.lines, i.status]),
    [
      ["b", ["from b"], "running"],
      ["a", ["from a"], "ok"],
    ],
  );
});

test("output whose START is outside the window is kept as an entry without a request id", () => {
  const [inv] = groupInvocations([ev(1, "tail of an earlier run"), ev(2, "END RequestId: z")]);
  assert.equal(inv!.requestId, "");
  assert.deepEqual(inv!.lines, ["tail of an earlier run"]);
});

test("Node.js: a failure is the runtime's Invoke Error line; console.error output alone is not one", () => {
  const ok = groupInvocations([
    ev(1, "START RequestId: n1 Version: $LATEST"),
    ev(2, "2026-11-17T04:12:00.661Z\tn1\tINFO\tnode line one"),
    ev(3, "2026-11-17T04:12:00.662Z\tn1\tERROR\tnode error line"),
    ev(
      4,
      "REPORT RequestId: n1\tDuration: 38.84 ms\tBilled Duration: 39 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB",
    ),
  ]);
  assert.equal(ok[0]!.status, "ok");

  const [bad] = groupInvocations([
    ev(1, "START RequestId: n2 Version: $LATEST"),
    ev(
      2,
      '2026-11-17T04:12:00.987Z\tn2\tERROR\tInvoke Error \t{"errorType":"Error","errorMessage":"node boom","stack":["Error: node boom"]}',
    ),
    ev(
      3,
      "REPORT RequestId: n2\tDuration: 19.13 ms\tBilled Duration: 20 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB",
    ),
  ]);
  assert.equal(bad!.status, "error");
  assert.equal(bad!.error, "Error: node boom");
});

test("Python: logging output at ERROR level is not a failure either", () => {
  const [inv] = groupInvocations([
    ev(1, "START RequestId: p1 Version: $LATEST"),
    ev(2, "[ERROR]\t2026-11-17T04:12:00.987Z\tp1\tsomething logged"),
    ev(3, "REPORT RequestId: p1\tDuration: 1.00 ms\tBilled Duration: 1 ms\tMemory Size: 128 MB\tMax Memory Used: 1 MB"),
  ]);
  assert.equal(inv!.status, "ok");
});
