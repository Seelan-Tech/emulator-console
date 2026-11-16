import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { GET as listAudit } from "@/app/api/audit/route";
import { one, query } from "@/lib/db";
import { checkRestart } from "@/lib/restart-watch";
import type { TargetRow } from "@/lib/targets";

import { credsRoot } from "../setup/integration";
import { call } from "../support/api";
import { seedTarget } from "../support/seed";

describe("checkRestart", () => {
  const writeCreds = (dir: string, keyId: string, stamp: number) => {
    const full = join(credsRoot, dir);
    mkdirSync(full, { recursive: true });
    writeFileSync(
      join(full, "emulator_credentials"),
      `[default]\naws_access_key_id = ${keyId}\naws_secret_access_key = s\n`,
    );
    writeFileSync(join(full, "ca.pem"), "pem");
    for (const f of ["emulator_credentials", "ca.pem"]) utimesSync(join(full, f), stamp, stamp);
  };
  const load = async (id: string) => (await one<TargetRow>("select * from targets where id = $1", [id]))!;

  const filesTarget = () => seedTarget("files", { filesDir: "9297" });

  test("first sighting is remembered without raising a restart", async () => {
    writeCreds("9297", "KEY1", 1000);
    const id = await filesTarget();
    const t = await checkRestart(await load(id));
    expect(t.instance_fingerprint).toBeTruthy();
    expect(t.restarted_at).toBeNull();
  });

  test("a changed access key is a restart; the same key is not", async () => {
    writeCreds("9297", "KEY1", 1000);
    const id = await filesTarget();
    await checkRestart(await load(id));
    expect((await checkRestart(await load(id))).restarted_at).toBeNull();
    writeCreds("9297", "KEY2", 2000);
    const after = await checkRestart(await load(id));
    expect(after.restarted_at).not.toBeNull();
    expect(after.restart_acknowledged_at).toBeNull();
  });

  test("with several instances racing, exactly one records the restart", async () => {
    writeCreds("9297", "KEY1", 1000);
    const id = await filesTarget();
    await checkRestart(await load(id));
    writeCreds("9297", "KEY2", 2000);
    const stale = await load(id); // every instance read the row before anyone updated it
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => checkRestart({ ...stale })));
    const winners = (await query("select 1 from targets where restarted_at is not null")).length;
    expect(winners).toBe(1);
    expect(new Set(results.map((r) => r.instance_fingerprint)).size).toBe(1);
  });
});

describe("audit log", () => {
  test("pages newest-first with a keyset cursor and hides reads unless asked", async () => {
    const tid = await seedTarget();
    for (let i = 0; i < 7; i++) {
      await query(
        "insert into audit_log(target_id, source, service, operation, mutating, ok, duration_ms) values ($1,'console','s3',$2,$3,true,1)",
        [tid, i % 2 ? `Get${i}` : `Put${i}`, i % 2 === 0],
      );
    }
    const page1 = await call(listAudit, "GET", "/x", { query: "limit=3&all=1" });
    expect(page1.body).toHaveLength(3);
    const ids = (page1.body as unknown as { id: string }[]).map((r) => Number(r.id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const page2 = await call(listAudit, "GET", "/x", { query: `limit=3&all=1&before=${ids.at(-1)}` });
    const ids2 = (page2.body as unknown as { id: string }[]).map((r) => Number(r.id));
    expect(ids2).toHaveLength(3);
    expect(Math.max(...ids2)).toBeLessThan(Math.min(...ids));
    const mutatingOnly = await call(listAudit, "GET", "/x");
    expect(mutatingOnly.body).toHaveLength(4);
  });
});
