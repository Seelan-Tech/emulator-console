import assert from "node:assert/strict";

import * as ddb from "@aws-sdk/client-dynamodb";
import * as ec2 from "@aws-sdk/client-ec2";
import * as s3 from "@aws-sdk/client-s3";
import * as sqs from "@aws-sdk/client-sqs";
import { test } from "vitest";

import { type Field, inputField } from "./schema";

const struct = (f: Field | null) => {
  assert.equal(f?.kind, "struct");
  return f.fields;
};
const by = (fs: ReturnType<typeof struct>, name: string) => fs.find((x) => x.name === name)!;

// Golden checks against real SDK operations: if an SDK upgrade changes the schema format these fail loudly.
test("SQS SendMessage: required members first, simple types, a map", () => {
  const f = struct(inputField((sqs as any)["SendMessage$"]));
  assert.deepEqual(
    f.filter((x) => x.required).map((x) => x.name),
    ["QueueUrl", "MessageBody"],
  );
  assert.equal(by(f, "DelaySeconds").field.kind, "number");
  assert.equal(by(f, "MessageBody").field.kind, "string");
  assert.equal(by(f, "MessageAttributes").field.kind, "map");
});

test("S3 PutObject: streaming blob body, required bucket and key", () => {
  const f = struct(inputField((s3 as any)["PutObject$"]));
  assert.deepEqual(
    f.filter((x) => x.required).map((x) => x.name),
    ["Bucket", "Key"],
  );
  assert.deepEqual(by(f, "Body").field, { kind: "blob", streaming: true });
});

test("DynamoDB CreateTable: nested lists of structs with their own required members", () => {
  const f = struct(inputField((ddb as any)["CreateTable$"]));
  assert.equal(by(f, "TableName").required, true);
  const keySchema = by(f, "KeySchema").field;
  assert.equal(keySchema.kind, "list");
  const el = keySchema.item;
  const elFields = struct(el);
  assert.deepEqual(
    elFields.map((x) => [x.name, x.required]),
    [
      ["AttributeName", true],
      ["KeyType", true],
    ],
  );
  assert.equal(by(struct(by(f, "ProvisionedThroughput").field), "ReadCapacityUnits").field.kind, "number");
});

test("recursive shapes terminate: the cycle is cut to free JSON", () => {
  const f = struct(inputField((ddb as any)["PutItem$"]));
  const item = by(f, "Item").field;
  assert.equal(item.kind, "map");
  // AttributeValue is a struct whose M and L members refer back to AttributeValue itself.
  const attributeValue = struct(item.value);
  assert.equal(by(attributeValue, "S").field.kind, "string");
  const nested = by(attributeValue, "M").field as Extract<Field, { kind: "map" }>;
  assert.equal(nested.kind, "map");
  assert.equal(nested.value.kind, "document");
  assert.ok(JSON.stringify(f).length < 20_000);
});

test("EC2 RunInstances converts deeply nested input without throwing and stays bounded", () => {
  const f = inputField((ec2 as any)["RunInstances$"]);
  assert.equal(f?.kind, "struct");
  assert.ok(JSON.stringify(f).length < 500_000);
});

test("garbage in, null out", () => {
  assert.equal(inputField(undefined), null);
  assert.equal(inputField([9, "ns", "Op", 0, null, null]), null);
});
