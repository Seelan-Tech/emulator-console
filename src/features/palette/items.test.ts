import assert from "node:assert/strict";

import { test } from "vitest";

import {
  actionItems,
  bucketItems,
  navigationItems,
  operationItems,
  pushRecent,
  queueItems,
  rank,
  recentItems,
  secretItems,
  targetItems,
} from "./items";

const T = "t1";

test("with no query only the quick groups show", () => {
  const items = [
    ...navigationItems(T),
    ...bucketItems(T, ["assets"]),
    ...operationItems(T, { s3: ["PutObject"] }),
    ...actionItems(),
  ];
  const groups = new Set(rank(items, "").map((r) => r.group));
  assert.deepEqual([...groups].sort(), ["Actions", "Go to"]);
});

test("typing searches everything and groups results in a fixed order", () => {
  const items = [...navigationItems(T), ...bucketItems(T, ["s3-assets"]), ...operationItems(T, { s3: ["PutObject"] })];
  const r = rank(items, "s3");
  assert.deepEqual([...new Set(r.map((x) => x.group))], ["Go to", "Resources", "Operations"]);
  assert.ok(r.some((x) => x.label === "s3-assets"));
  assert.ok(r.some((x) => x.label === "s3.PutObject"));
});

test("resources link to their screens, with names encoded", () => {
  assert.equal(bucketItems(T, ["my bucket"])[0]!.href, "/t/t1/s3/my%20bucket");
  assert.equal(
    queueItems(T, ["https://sqs.us-east-1.amazonaws.com/000000000000/jobs.fifo"])[0]!.href,
    "/t/t1/sqs/jobs.fifo",
  );
  assert.equal(secretItems(T, ["app/db"])[0]!.href, "/t/t1/secrets/detail?name=app%2Fdb");
  assert.equal(operationItems(T, { ssm: ["PutParameter"] })[0]!.href, "/t/t1/s/ssm/PutParameter");
});

test("target-less pages only offer workspace navigation", () => {
  const ids = navigationItems(null).map((i) => i.id);
  assert.deepEqual(ids, ["nav:targets", "nav:fixtures", "nav:activity"]);
});

test("a service screen link uses the native route when there is one, else the operations list", () => {
  const nav = navigationItems(T);
  assert.equal(nav.find((i) => i.id === "nav:dynamodb")!.href, "/t/t1/dynamodb");
  assert.equal(nav.find((i) => i.id === "nav:kms")!.href, "/t/t1/s/kms");
});

test("best match first within a group", () => {
  const items = [...bucketItems(T, ["my-logs", "logs", "catalog-sources"])];
  assert.equal(rank(items, "logs")[0]!.label, "logs");
});

test("recents: newest first, deduplicated, capped, and actions are never remembered", () => {
  const a = targetItems([{ id: "1", name: "one" }])[0]!;
  let list = pushRecent([], a);
  list = pushRecent(list, { ...a, id: "x", label: "x" });
  list = pushRecent(list, a);
  assert.deepEqual(
    list.map((r) => r.id),
    ["target:1", "x"],
  );
  assert.equal(pushRecent(list, actionItems()[0]!).length, 2);
  let many: ReturnType<typeof pushRecent> = [];
  for (let i = 0; i < 20; i++) many = pushRecent(many, { ...a, id: `i${i}` });
  assert.equal(many.length, 6);
  assert.equal(recentItems(many)[0]!.group, "Recent");
});

test("no query shows recents only in the empty state", () => {
  const items = [...recentItems([{ id: "r", label: "Recent thing", href: "/x" }]), ...navigationItems(T)];
  assert.ok(rank(items, "").some((x) => x.group === "Recent"));
  assert.ok(!rank(items, "thing").some((x) => x.group === "Recent"));
});

test("in the empty state a recent item isn't listed a second time under Go to", () => {
  const nav = navigationItems(T);
  const dynamo = nav.find((i) => i.id === "nav:dynamodb")!;
  const r = rank(
    [...recentItems([{ id: dynamo.id, label: dynamo.label, hint: dynamo.hint, href: dynamo.href }]), ...nav],
    "",
  );
  assert.equal(r.filter((x) => x.id === "nav:dynamodb").length, 1);
  assert.equal(r.find((x) => x.id === "nav:dynamodb")!.group, "Recent");
  // …but searching still finds it, once, under Go to
  assert.equal(
    rank([...recentItems([{ id: dynamo.id, label: dynamo.label, href: dynamo.href }]), ...nav], "dynamo").filter(
      (x) => x.id === "nav:dynamodb",
    ).length,
    1,
  );
});

test("ids are unique across what the palette builds", () => {
  const all = [
    ...navigationItems(T),
    ...bucketItems(T, ["a"]),
    ...queueItems(T, ["https://x/000/a"]),
    ...operationItems(T, { s3: ["PutObject"], sqs: ["PutObject"] }),
  ];
  assert.equal(new Set(all.map((i) => i.id)).size, all.length);
});
