import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildRequest,
  consistentAllowed,
  emptyFilter,
  emptySpec,
  keySchemaFor,
  type QuerySpec,
  type TableShape,
  toCli,
} from "./query";

const shape: TableShape = {
  KeySchema: [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "pk", AttributeType: "S" },
    { AttributeName: "sk", AttributeType: "N" },
    { AttributeName: "gpk", AttributeType: "S" },
  ],
  GlobalSecondaryIndexes: [{ IndexName: "by-g", KeySchema: [{ AttributeName: "gpk", KeyType: "HASH" }] }],
  LocalSecondaryIndexes: [
    {
      IndexName: "by-sk2",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    },
  ],
};
const spec = (o: Partial<QuerySpec>): QuerySpec => ({ ...emptySpec(), ...o });
const f = (o: Partial<ReturnType<typeof emptyFilter>>) => ({ ...emptyFilter(), ...o });
const req = (o: Partial<QuerySpec>, start?: any) => buildRequest(shape, "T", spec(o), 25, start);

test("a plain scan carries only the table and limit", () => {
  assert.deepEqual(req({}), { operation: "Scan", input: { TableName: "T", Limit: 25 } });
});

test("partition key query is typed from the table definitions", () => {
  const r = req({ mode: "query", pk: "user-1" });
  assert.equal(r.operation, "Query");
  assert.equal(r.input.KeyConditionExpression, "#h = :h");
  assert.deepEqual(r.input.ExpressionAttributeValues, { ":h": { S: "user-1" } });
});

test("sort key operators, including between and begins_with, are typed (number sort key)", () => {
  assert.equal(
    req({ mode: "query", pk: "a", skOp: ">=", sk: "10" }).input.KeyConditionExpression,
    "#h = :h AND #r >= :r",
  );
  const b = req({ mode: "query", pk: "a", skOp: "between", sk: "1", sk2: "9" });
  assert.equal(b.input.KeyConditionExpression, "#h = :h AND #r BETWEEN :r AND :r2");
  assert.deepEqual(b.input.ExpressionAttributeValues, { ":h": { S: "a" }, ":r": { N: "1" }, ":r2": { N: "9" } });
  assert.throws(() => req({ mode: "query", pk: "a", skOp: "between", sk: "1" }), /both values/);
  assert.throws(() => req({ mode: "query", pk: "a", sk: "abc" }), /number/);
  assert.equal(req({ mode: "query", pk: "a" }).input.KeyConditionExpression, "#h = :h"); // sort key is optional
});

test("a query needs a partition key value", () => {
  assert.throws(() => req({ mode: "query" }), /partition key “pk”/);
});

test("indexes: key schema and index name come from the chosen index; GSIs can't be read consistently", () => {
  assert.deepEqual(keySchemaFor(shape, "by-g"), [{ AttributeName: "gpk", KeyType: "HASH" }]);
  const r = req({ mode: "query", index: "by-g", pk: "x", consistent: true });
  assert.equal(r.input.IndexName, "by-g");
  assert.equal(r.input.ConsistentRead, undefined);
  assert.equal(consistentAllowed(shape, "by-g"), false);
  assert.equal(consistentAllowed(shape, "by-sk2"), true);
  assert.equal(req({ mode: "query", index: "by-sk2", pk: "x", consistent: true }).input.ConsistentRead, true);
  assert.equal(req({ consistent: true }).input.ConsistentRead, true);
  assert.throws(() => req({ index: "nope" }), /not found/);
});

test("descending order only applies to queries", () => {
  assert.equal(req({ mode: "query", pk: "a", descending: true }).input.ScanIndexForward, false);
  assert.equal(req({ mode: "query", pk: "a" }).input.ScanIndexForward, undefined);
  assert.equal(req({ descending: true }).input.ScanIndexForward, undefined);
});

test("filters build parenthesized expressions with typed values, joined by AND or OR", () => {
  const r = req({
    filters: [
      f({ attr: "status", value: "open" }),
      f({ attr: "total", op: ">=", type: "N", value: "10.5" }),
      f({ attr: "archived", type: "BOOL", value: "false" }),
    ],
  });
  assert.equal(r.input.FilterExpression, "(#f0_0 = :f0) AND (#f1_0 >= :f1) AND (#f2_0 = :f2)");
  assert.deepEqual(r.input.ExpressionAttributeValues, {
    ":f0": { S: "open" },
    ":f1": { N: "10.5" },
    ":f2": { BOOL: false },
  });
  assert.equal(
    req({ join: "OR", filters: [f({ attr: "a", value: "1" }), f({ attr: "b", value: "2" })] }).input.FilterExpression,
    "(#f0_0 = :f0) OR (#f1_0 = :f1)",
  );
});

test("filter operators: begins_with, contains, not contains, exists, not exists, not equal", () => {
  const expr = (o: any) => req({ filters: [f({ attr: "x", value: "v", ...o })] }).input.FilterExpression;
  assert.equal(expr({ op: "begins_with" }), "(begins_with(#f0_0, :f0))");
  assert.equal(expr({ op: "contains" }), "(contains(#f0_0, :f0))");
  assert.equal(expr({ op: "not_contains" }), "(NOT contains(#f0_0, :f0))");
  assert.equal(expr({ op: "<>" }), "(#f0_0 <> :f0)");
  const e = req({ filters: [f({ attr: "x", op: "exists" }), f({ attr: "y", op: "not_exists" })] });
  assert.equal(e.input.FilterExpression, "(attribute_exists(#f0_0)) AND (attribute_not_exists(#f1_0))");
  assert.equal(e.input.ExpressionAttributeValues, undefined); // no values for existence checks
});

test("nested attribute paths get a placeholder per segment, so reserved words are safe", () => {
  const r = req({ filters: [f({ attr: "address.city", value: "Oslo" })] });
  assert.equal(r.input.FilterExpression, "(#f0_0.#f0_1 = :f0)");
  assert.deepEqual(r.input.ExpressionAttributeNames, { "#f0_0": "address", "#f0_1": "city" });
});

test("incomplete filters are reported, empty ones ignored", () => {
  assert.throws(() => req({ filters: [f({ attr: "", value: "x" })] }), /choose an attribute/);
  assert.throws(() => req({ filters: [f({ attr: "n", type: "N", value: "abc" })] }), /number/);
  assert.throws(() => req({ filters: [f({ attr: "b", type: "BOOL", value: "" })] }), /true or false/);
  assert.deepEqual(req({ filters: [f({})] }).input, { TableName: "T", Limit: 25 });
});

test("a query can't filter on a key attribute (DynamoDB rejects it), but a scan can", () => {
  assert.throws(
    () => req({ mode: "query", pk: "a", filters: [f({ attr: "sk", type: "N", value: "1" })] }),
    /key attribute/,
  );
  assert.throws(() => req({ mode: "query", pk: "a", filters: [f({ attr: "pk", value: "a" })] }), /key attribute/);
  assert.ok(req({ filters: [f({ attr: "sk", type: "N", value: "1" })] }).input.FilterExpression);
  // on the GSI the key attribute is gpk, so pk becomes an ordinary attribute
  assert.ok(
    req({ mode: "query", index: "by-g", pk: "x", filters: [f({ attr: "pk", value: "a" })] }).input.FilterExpression,
  );
});

test("the start key is passed through for paging", () => {
  assert.deepEqual(req({}, { pk: { S: "a" } }).input.ExclusiveStartKey, { pk: { S: "a" } });
});

test("CLI export quotes values and omits paging", () => {
  const cli = toCli(
    req(
      { mode: "query", pk: "o'brien", descending: true, filters: [f({ attr: "s", value: "x" })] },
      { pk: { S: "a" } },
    ),
  );
  assert.match(cli, /^aws dynamodb query/);
  assert.match(cli, /--table-name 'T'/);
  assert.match(cli, /--key-condition-expression '#h = :h'/);
  assert.match(cli, /--no-scan-index-forward/);
  assert.ok(cli.includes(`"o'\\''brien"`), cli); // the apostrophe is shell-escaped inside the JSON argument
  assert.ok(!cli.includes("--limit") && !cli.includes("exclusive-start-key"));
});
