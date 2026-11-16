import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { DELETE as removeFixture, GET as readFixture, PUT as updateFixture } from "@/app/api/fixtures/[fid]/route";
import { GET as listFixtures, POST as createFixture } from "@/app/api/fixtures/route";
import { DELETE as removeTarget, GET as readTarget, PATCH as updateTarget } from "@/app/api/targets/[tid]/route";
import { GET as listTargets, POST as createTarget } from "@/app/api/targets/route";
import { query } from "@/lib/db";
import { ensureLocalTarget } from "@/lib/local-target";

import { credsRoot } from "../setup/integration";
import { call } from "../support/api";

const staticTarget = (name: string) => ({
  name,
  endpointUrl: "https://emulator:9297",
  authMode: "static",
  accessKeyId: "AKIA",
  secretAccessKey: "super-secret",
});

describe("targets", () => {
  test("create, list and read never expose the secret; names are unique", async () => {
    const made = await call(createTarget, "POST", "/api/targets", { body: staticTarget("one") });
    expect(made.status).toBe(201);
    expect(JSON.stringify(made.body)).not.toContain("super-secret");
    const list = await call(listTargets, "GET", "/api/targets");
    expect(list.body).toHaveLength(1);
    const read = await call(readTarget, "GET", "/x", { params: { tid: made.body.id } });
    expect(read.status).toBe(200);
    const dup = await call(createTarget, "POST", "/api/targets", { body: staticTarget("one") });
    expect(dup.status).toBe(409);
  });

  test("unknown and malformed ids are a 404", async () => {
    for (const tid of ["nope", "00000000-0000-0000-0000-000000000000"]) {
      expect((await call(readTarget, "GET", "/x", { params: { tid } })).status).toBe(404);
    }
  });

  test("a baseline must be an existing fixture, and auto-replay needs a files target", async () => {
    const t = await call(createTarget, "POST", "/api/targets", { body: staticTarget("one") });
    const params = { tid: t.body.id as string };
    const missing = await call(updateTarget, "PATCH", "/x", {
      params,
      body: { baselineFixtureId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(missing.status).toBe(400);
    const f = await call(createFixture, "POST", "/api/fixtures", { body: { name: "base", steps: [] } });
    const ok = await call(updateTarget, "PATCH", "/x", { params, body: { baselineFixtureId: f.body.id } });
    expect(ok.status).toBe(200);
    const auto = await call(updateTarget, "PATCH", "/x", { params, body: { autoReplay: true } });
    expect(auto.status).toBe(400); // static targets cannot detect a restart
  });

  test("delete removes the target", async () => {
    const t = await call(createTarget, "POST", "/api/targets", { body: staticTarget("gone") });
    const params = { tid: t.body.id as string };
    expect((await call(removeTarget, "DELETE", "/x", { params })).status).toBe(200);
    expect((await call(readTarget, "GET", "/x", { params })).status).toBe(404);
  });
});

describe("fixtures", () => {
  const steps = [{ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }];

  test("create, list with step counts, update, delete", async () => {
    const made = await call(createFixture, "POST", "/api/fixtures", { body: { name: "seed", steps } });
    expect(made.status).toBe(201);
    const list = await call(listFixtures, "GET", "/api/fixtures");
    expect(list.body).toEqual([expect.objectContaining({ name: "seed", step_count: 1 })]);
    const params = { fid: made.body.id as string };
    const put = await call(updateFixture, "PUT", "/x", { params, body: { description: "d" } });
    expect(put.body.description).toBe("d");
    expect(put.body.steps).toHaveLength(1); // untouched fields stay
    expect((await call(removeFixture, "DELETE", "/x", { params })).status).toBe(200);
    expect((await call(readFixture, "GET", "/x", { params })).status).toBe(404);
  });

  test("names are unique", async () => {
    await call(createFixture, "POST", "/api/fixtures", { body: { name: "seed", steps: [] } });
    const dup = await call(createFixture, "POST", "/api/fixtures", { body: { name: "seed", steps: [] } });
    expect(dup.status).toBe(409);
  });
});

describe("the Local emulator target", () => {
  test("is created once when the emulator's credential folder is mounted", async () => {
    mkdirSync(join(credsRoot, "9297"), { recursive: true });
    writeFileSync(join(credsRoot, "9297", "emulator_credentials"), "[default]\n");
    await ensureLocalTarget();
    await ensureLocalTarget();
    const rows = await query("select name, auth_mode, files_dir, endpoint_url from targets");
    expect(rows).toEqual([
      { name: "Local emulator", auth_mode: "files", files_dir: "9297", endpoint_url: "https://emulator:9297" },
    ]);
  });
});
