import assert from "node:assert/strict";

import { test } from "vitest";

import { itemKey, itemTemplate, marshal, marshalItem, unmarshal, unmarshalItem } from "./marshal";

const roundTrip = (av: any) => assert.deepEqual(marshal(unmarshal(av)), av);

test("every attribute type round-trips exactly", () => {
  roundTrip({ S: "text" });
  roundTrip({ N: "42" });
  roundTrip({ N: "3.5" });
  roundTrip({ BOOL: false });
  roundTrip({ NULL: true });
  roundTrip({ L: [{ S: "a" }, { N: "1" }, { M: { k: { BOOL: true } } }] });
  roundTrip({ M: { a: { S: "x" }, b: { L: [] } } });
  roundTrip({ SS: ["a", "b"] });
  roundTrip({ NS: ["1", "2.5"] });
  roundTrip({ B: "aGVsbG8=" });
  roundTrip({ BS: ["YQ==", "Yg=="] });
});

test("numbers that don't fit a JS number are preserved as tagged strings", () => {
  const big = { N: "12345678901234567890123" };
  assert.deepEqual(unmarshal(big), { $n: "12345678901234567890123" });
  roundTrip(big);
  roundTrip({ N: "1.10" }); // trailing zero would be lost as a JS number
});

test("plain JSON reads naturally", () => {
  assert.deepEqual(unmarshalItem({ id: { S: "1" }, n: { N: "2" }, ok: { BOOL: true }, tags: { SS: ["x"] } }), {
    id: "1",
    n: 2,
    ok: true,
    tags: { $ss: ["x"] },
  });
  assert.deepEqual(marshalItem({ id: "1", n: 2, nested: { a: [1, "b", null] } }), {
    id: { S: "1" },
    n: { N: "2" },
    nested: { M: { a: { L: [{ N: "1" }, { S: "b" }, { NULL: true }] } } },
  });
});

test("invalid values are rejected with a clear error", () => {
  assert.throws(() => marshal(undefined), /unsupported/);
  assert.throws(() => marshal(Infinity), /finite/);
  assert.throws(() => marshal({ $ss: [1, 2] }), /\$ss/);
  assert.throws(() => marshal({ $b: 5 }), /\$b/);
});

test("key helpers", () => {
  const ks = [
    { AttributeName: "pk", KeyType: "HASH" as const },
    { AttributeName: "sk", KeyType: "RANGE" as const },
  ];
  const defs = [
    { AttributeName: "pk", AttributeType: "S" as const },
    { AttributeName: "sk", AttributeType: "N" as const },
  ];
  assert.deepEqual(itemTemplate(ks, defs), { pk: "", sk: 0 });
  assert.deepEqual(itemKey({ pk: "a", sk: 3, other: 1 }, ks), { pk: { S: "a" }, sk: { N: "3" } });
});
