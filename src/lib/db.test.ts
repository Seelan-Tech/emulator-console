import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { closeDb, firstRow, isUuid, NOW, one, query } from "./db";
import { isUniqueViolation } from "./errors";

beforeEach(() => {
  vi.stubEnv("DATA_DIR", ":memory:");
  closeDb();
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
});

const newTarget = (name: string) =>
  query<{ id: string }>(
    "insert into targets(name, endpoint_url, auth_mode, files_dir) values ($1, 'https://e:1', 'files', 'x') returning id",
    [name],
  );

test("the schema is applied on first use and ids are v4 UUIDs", async () => {
  const [t] = await newTarget("a");
  assert.ok(isUuid(t!.id));
  assert.match(t!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("booleans and JSON round-trip as booleans and values", async () => {
  const [t] = await newTarget("a");
  await query("update targets set auto_replay = $2 where id = $1", [t!.id, true]);
  assert.equal(
    (await one<{ auto_replay: boolean }>("select auto_replay from targets where id = $1", [t!.id]))!.auto_replay,
    true,
  );
  const steps = [{ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }];
  const f = firstRow(
    await query<{ id: string }>("insert into fixtures(name, steps) values ('f', $1) returning id", [steps]),
  );
  const row = await one<{ steps: unknown[] }>("select steps from fixtures where id = $1", [f.id]);
  assert.deepEqual(row!.steps, steps);
  assert.equal((await one<{ n: number }>("select json_array_length(steps) as n from fixtures"))!.n, 1);
});

test("timestamps are ISO strings and NOW can be used in statements", async () => {
  const [t] = await newTarget("a");
  await query(`update targets set last_seen_at = ${NOW} where id = $1`, [t!.id]);
  const row = await one<{ created_at: string; last_seen_at: string }>("select created_at, last_seen_at from targets");
  for (const v of [row!.created_at, row!.last_seen_at]) assert.match(v, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test("a duplicate name is recognised as a unique violation", async () => {
  await newTarget("a");
  await assert.rejects(newTarget("a"), (e) => isUniqueViolation(e));
  await assert.rejects(query("select * from nope"), (e) => !isUniqueViolation(e));
});

test("foreign keys are enforced: deleting a fixture removes its runs and clears baselines", async () => {
  const f = firstRow(await query<{ id: string }>("insert into fixtures(name) values ('f') returning id"));
  const [t] = await newTarget("a");
  await query("update targets set baseline_fixture_id = $2 where id = $1", [t!.id, f.id]);
  await query("insert into fixture_runs(fixture_id, target_id, status) values ($1, $2, 'succeeded')", [f.id, t!.id]);
  await query("delete from fixtures where id = $1", [f.id]);
  assert.equal((await query("select 1 from fixture_runs")).length, 0);
  assert.equal(
    (await one<{ baseline_fixture_id: string | null }>("select baseline_fixture_id from targets"))!.baseline_fixture_id,
    null,
  );
});

test("check constraints reject a target without credentials", async () => {
  await assert.rejects(query("insert into targets(name, endpoint_url, auth_mode) values ('x', 'https://e', 'static')"));
});
