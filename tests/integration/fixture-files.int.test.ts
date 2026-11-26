import { describe, expect, test } from "vitest";

import { GET as exportFixtures } from "@/app/api/fixtures/export/route";
import { POST as importFixtures } from "@/app/api/fixtures/import/route";
import { GET as listFixtures, POST as createFixture } from "@/app/api/fixtures/route";
import { query } from "@/lib/db";
import { bundleFile, fixtureFile } from "@/lib/fixture-file";

import { call } from "../support/api";

const bucket = (b: string) => ({ service: "s3", operation: "CreateBucket", input: { Bucket: b } });
const send = (text: string, extra: object = {}) =>
  call(importFixtures, "POST", "/api/fixtures/import", { body: { text, ...extra } });
const names = async () =>
  ((await call(listFixtures, "GET", "/api/fixtures")).body as { name: string }[]).map((x) => x.name);

describe("importing fixture files", () => {
  test("a dry run says what would happen and changes nothing", async () => {
    await call(createFixture, "POST", "/api/fixtures", { body: { name: "orders", steps: [] } });
    const file = bundleFile([
      { name: "orders", description: "", steps: [bucket("b")] },
      {
        name: "fresh",
        description: "",
        steps: [{ service: "secretsmanager", operation: "CreateSecret", input: { Name: "n", SecretString: "x" } }],
      },
    ]);
    const r = await send(file, { dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([
      expect.objectContaining({
        name: "fresh",
        action: "create",
        steps: 1,
        secrets: [expect.objectContaining({ call: "secretsmanager.CreateSecret" })],
      }),
      expect.objectContaining({ name: "orders (2)", originalName: "orders", action: "rename" }),
    ]);
    expect(await names()).toEqual(["orders"]);
  });

  test("an import creates fixtures and, for a name that exists, renames, replaces or skips", async () => {
    const created = await call(createFixture, "POST", "/api/fixtures", {
      body: { name: "orders", description: "old", steps: [] },
    });
    const file = fixtureFile({ name: "orders", description: "new", steps: [bucket("b")] });

    const renamed = await send(file); // rename is the default
    expect(renamed.body.items[0]).toMatchObject({ name: "orders (2)", action: "rename" });
    expect(await names()).toEqual(["orders", "orders (2)"]);

    const skipped = await send(file, { onConflict: "skip" });
    expect(skipped.body.items[0]).toMatchObject({ action: "skip" });
    expect(skipped.body.items[0].id).toBeUndefined();
    expect(await names()).toEqual(["orders", "orders (2)"]);

    const replaced = await send(file, { onConflict: "replace" });
    expect(replaced.body.items[0]).toMatchObject({ name: "orders", action: "replace", id: created.body.id });
    const rows = await query<{ description: string; steps: string }>(
      "select description, steps from fixtures where name = 'orders'",
    );
    expect(rows[0]!.description).toBe("new");
    expect(JSON.stringify(rows[0]!.steps)).toContain("CreateBucket");
  });

  test("a fixture that is not valid is reported and the others are imported", async () => {
    const file = JSON.stringify({
      format: "emulator-console-fixtures",
      version: 1,
      fixtures: [
        { name: "good", steps: [bucket("b")] },
        { name: "broken", steps: [{ service: "nope", operation: "X" }] },
        { name: "twice", steps: [] },
        { name: "twice", steps: [] },
      ],
    });
    const r = await send(file);
    expect(r.body.items.map((i: any) => `${i.name}:${i.action}`)).toEqual([
      "good:create",
      "broken:invalid",
      "twice:invalid",
      "twice:invalid",
    ]);
    expect(r.body.items[2].error).toMatch(/more than once/);
    expect(await names()).toEqual(["good"]);
  });

  test("a file that is not a fixture file is a 400", async () => {
    expect((await send("not json")).status).toBe(400);
    expect((await send('{"format":"emulator-console-fixtures","version":1,"fixtures":[]}')).body.error).toMatch(
      /no fixtures/,
    );
    expect((await send('{"format":"emulator-console-fixture","version":9,"steps":[]}')).body.error).toMatch(
      /version 9/,
    );
  });

  test("an export is a bundle that imports back unchanged", async () => {
    await call(createFixture, "POST", "/api/fixtures", { body: { name: "b-two", steps: [bucket("two")] } });
    await call(createFixture, "POST", "/api/fixtures", { body: { name: "a-one", description: "first", steps: [] } });
    const res = await exportFixtures(new Request("http://localhost:3000/api/fixtures/export") as never, {
      params: Promise.resolve({}),
    });
    expect(res.headers.get("content-disposition")).toContain("emulator-console-fixtures.json");
    const text = await res.text();
    expect(text.indexOf("a-one")).toBeLessThan(text.indexOf("b-two"));
    await query("delete from fixtures");
    const back = await send(text);
    expect(back.body.items.map((i: any) => i.action)).toEqual(["create", "create"]);
    expect(await names()).toEqual(["a-one", "b-two"]);
  });
});
