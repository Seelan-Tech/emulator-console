import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { cliCommand, cliOperation, cliScript } from "./cli-command";

test("operation names become CLI sub-commands", () => {
  assert.equal(cliOperation("CreateQueue"), "create-queue");
  assert.equal(cliOperation("ListObjectsV2"), "list-objects-v2");
  assert.equal(cliOperation("AssumeRoleWithSAML"), "assume-role-with-saml");
  assert.equal(cliOperation("DescribeLogGroups"), "describe-log-groups");
});

test("a call becomes one command with the input as JSON", () => {
  assert.equal(
    cliCommand({ service: "sqs", operation: "CreateQueue", input: { QueueName: "q" } }),
    `aws sqs create-queue --cli-input-json '{"QueueName":"q"}'`,
  );
  assert.equal(cliCommand({ service: "sns", operation: "ListTopics", input: {} }), "aws sns list-topics");
  assert.equal(cliCommand({ service: "sns", operation: "ListTopics" }), "aws sns list-topics");
  assert.equal(
    cliCommand({ service: "sqs", operation: "ListQueues", region: "eu-west-1" }),
    "aws sqs list-queues --region eu-west-1",
  );
});

test("services the CLI names differently", () => {
  assert.match(
    cliCommand({ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }),
    /^aws s3api create-bucket /,
  );
  assert.match(cliCommand({ service: "eventbridge", operation: "ListEventBuses" }), /^aws events list-event-buses/);
  assert.match(cliCommand({ service: "sfn", operation: "ListStateMachines" }), /^aws stepfunctions /);
  assert.match(cliCommand({ service: "logs", operation: "DescribeLogGroups" }), /^aws logs describe-log-groups/);
});

test("single quotes in the input survive the shell quoting", () => {
  const c = cliCommand({ service: "sns", operation: "Publish", input: { Message: "it's" } });
  assert.equal(c, `aws sns publish --cli-input-json '{"Message":"it'\\''s"}'`);
});

test("blobs are base64 strings", () => {
  assert.equal(
    cliCommand({
      service: "lambda",
      operation: "UpdateFunctionCode",
      input: { FunctionName: "f", ZipFile: { $base64: "UEsDBA==" } },
    }),
    `aws lambda update-function-code --cli-input-json '{"FunctionName":"f","ZipFile":"UEsDBA=="}'`,
  );
});

test("invoke uses flags (the CLI rejects --cli-input-json for it), a base64 payload and an output file", () => {
  assert.equal(
    cliCommand({
      service: "lambda",
      operation: "Invoke",
      input: { FunctionName: "f", Payload: '{"a":1}', InvocationType: "Event" },
    }),
    "aws lambda invoke --function-name 'f' --payload 'eyJhIjoxfQ==' --invocation-type 'Event' response.json",
  );
  assert.equal(
    cliCommand({ service: "lambda", operation: "Invoke", input: { FunctionName: "f" } }),
    "aws lambda invoke --function-name 'f' response.json",
  );
});

test("a script keeps the order and adds the pauses of a replay", () => {
  const s = cliScript([
    { service: "dynamodb", operation: "CreateTable", input: { TableName: "t" }, delayAfterMs: 3000 },
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q" } },
  ]);
  assert.deepEqual(s.split("\n").slice(1), [
    `aws dynamodb create-table --cli-input-json '{"TableName":"t"}'`,
    "sleep 3",
    `aws sqs create-queue --cli-input-json '{"QueueName":"q"}'`,
  ]);
  assert.match(s.split("\n")[0]!, /^# /);
});

test("a script keeps captured values in shell variables and uses them in later steps", () => {
  const script = cliScript([
    {
      service: "kms",
      operation: "CreateKey",
      input: {},
      capture: { keyId: "KeyMetadata.KeyId", arn: "KeyMetadata.Arn" },
    },
    { service: "kms", operation: "CreateAlias", input: { AliasName: "alias/app", TargetKeyId: "{{keyId}}" } },
  ]).split("\n");
  assert.equal(
    script[1],
    `read -r keyId arn <<<"$(aws kms create-key --query '[KeyMetadata.KeyId, KeyMetadata.Arn]' --output text)"`,
  );
  assert.equal(
    script[2],
    `aws kms create-alias --cli-input-json '{"AliasName":"alias/app","TargetKeyId":"'"$keyId"'"}'`,
  );
});

// The generated script is run with bash, and a fake `aws` that answers like the CLI's text output would.
const runScript = (steps: Parameters<typeof cliScript>[0], aws: string) => {
  const script = `aws() { ${aws}; }\nsleep() { :; }\n${cliScript(steps)}\necho done`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status };
};
const read = (op: string, expect: Parameters<typeof cliScript>[0][number]["expect"], extra = {}) => ({
  service: "sqs",
  operation: op,
  input: { QueueUrl: "u" },
  expect,
  ...extra,
});
// answers each --query with a canned value
const answers = (m: Record<string, string>) =>
  `q=""; while [ $# -gt 0 ]; do [ "$1" = --query ] && q="$2"; shift; done; case "$q" in ${Object.entries(m)
    .map(([k, v]) => `"${k}") echo '${v}';;`)
    .join(" ")} *) ;; esac`;

test("an assertion becomes tests that stop the script when a check does not hold", () => {
  const steps = [read("GetQueueAttributes", [{ path: "Attributes.N", equals: "0" }])];
  assert.deepEqual(runScript(steps, answers({ "Attributes.N": "0" })), { out: "done", err: "", code: 0 });
  const bad = runScript(steps, answers({ "Attributes.N": "2" }));
  assert.equal(bad.code, 1);
  assert.equal(bad.err, "check failed: sqs.GetQueueAttributes");
  assert.equal(bad.out, ""); // the script stopped
  // a call that fails prints nothing: that is not a match either
  assert.equal(runScript(steps, "return 1").code, 1);
});

test("every exported matcher is tested the way the engine tests it", () => {
  const a = answers({
    "Attributes.N": "3",
    "length(Items)": "2",
    "Items != null": "True",
    "Gone != null": "False",
    "contains(Name, 'ord')": "True",
  });
  const pass = (e: object) => (runScript([read("GetQueueAttributes", [e as never])], a).code === 0 ? "pass" : "fail");
  assert.equal(pass({ path: "Attributes.N", equals: 3 }), "pass");
  assert.equal(pass({ path: "Attributes.N", equals: 4 }), "fail");
  assert.equal(pass({ path: "Attributes.N", notEquals: 4 }), "pass");
  assert.equal(pass({ path: "Attributes.N", notEquals: 3 }), "fail");
  assert.equal(pass({ path: "Missing", notEquals: 3 }), "fail"); // nothing came back
  assert.equal(pass({ path: "Items", length: 2 }), "pass");
  assert.equal(pass({ path: "Items", length: 3 }), "fail");
  assert.equal(pass({ path: "Items", exists: true }), "pass");
  assert.equal(pass({ path: "Gone", exists: false }), "pass");
  assert.equal(pass({ path: "Gone", exists: true }), "fail");
  assert.equal(pass({ path: "Name", contains: "ord" }), "pass");
  assert.equal(pass({ path: "Name", contains: "xyz" }), "fail");
  assert.equal(pass({ path: "Attributes.N", gt: 2 }), "pass");
  assert.equal(pass({ path: "Attributes.N", gt: 3 }), "fail");
  assert.equal(pass({ path: "Attributes.N", gte: 3 }), "pass");
  assert.equal(pass({ path: "Attributes.N", lt: 4 }), "pass");
  assert.equal(pass({ path: "Attributes.N", lte: 2 }), "fail");
  assert.equal(pass({ path: "Missing", lt: 4 }), "fail"); // nothing came back is not a number
});

test("an assertion with retries tries again until it holds, then stops", () => {
  const steps = [read("GetQueueAttributes", [{ path: "Attributes.N", equals: "0" }], { retries: 2 })];
  const dir = mkdtempSync(join(tmpdir(), "ec-retry-"));
  const counter = join(dir, "count");
  // answers 5 until the given call, then 0
  const flaky = (holdsOnCall: number) =>
    `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'; if [ $n -ge ${holdsOnCall} ]; then echo 0; else echo 5; fi`;
  try {
    assert.equal(runScript(steps, flaky(3)).code, 0); // the third try holds
    rmSync(counter);
    assert.equal(runScript(steps, flaky(4)).code, 1); // would hold on the fourth: only three tries
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(cliScript(steps), /for ec_try in 1 2 3; do/);
});

test("an assertion can compare with a variable an earlier step kept, and what cannot be exported is said so", () => {
  const script = cliScript([
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q" }, capture: { name: "QueueName" } },
    read("GetQueueAttributes", [
      { path: "Name", equals: "{{name}}" },
      { path: "Name", matches: "^q" },
      { path: "Items", equals: [1] },
    ]),
  ]);
  assert.match(script, /= ''"\$name"'' \]/);
  assert.match(script, /# not exported: Name: matches is not exported/);
  assert.match(script, /# not exported: Items: a list or object cannot be compared/);
  // nothing exportable: only the notes, and the read is not run
  const none = cliScript([read("GetQueueAttributes", [{ path: "Name", matches: "x" }])]);
  assert.ok(!none.includes("aws sqs"));
});
