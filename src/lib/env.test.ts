import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  ENV_DOCS,
  EnvError,
  envSchema,
  escapeCell,
  readEnv,
  renderConfigDoc,
  renderEnvExample,
  validateEnv,
} from "./env";

test("defaults apply when nothing is set", () => {
  const e = readEnv({});
  assert.equal(e.DATA_DIR, "./data");
  assert.equal(e.LOCAL_CREDENTIALS_ROOT, "/emu");
  assert.equal(e.ALLOW_LOCAL_CREDENTIAL_FILES, false);
  assert.deepEqual(e.LOCAL_ALLOWED_HOSTS, []);
});

test("values are typed: strings, booleans and lists", () => {
  const e = readEnv({
    DATA_DIR: "/var/lib/console",
    ALLOW_LOCAL_CREDENTIAL_FILES: "true",
    LOCAL_ALLOWED_HOSTS: " Foo.Example , bar ",
  });
  assert.equal(e.DATA_DIR, "/var/lib/console");
  assert.equal(e.ALLOW_LOCAL_CREDENTIAL_FILES, true);
  assert.deepEqual(e.LOCAL_ALLOWED_HOSTS, ["foo.example", "bar"]);
});

test("an empty string counts as unset", () => {
  const e = readEnv({ LOCAL_TARGET_ENDPOINT: "", DATA_DIR: "", ALLOW_LOCAL_CREDENTIAL_FILES: "" });
  assert.equal(e.LOCAL_TARGET_ENDPOINT, undefined);
  assert.equal(e.DATA_DIR, "./data");
  assert.equal(e.ALLOW_LOCAL_CREDENTIAL_FILES, false);
});

test("invalid values fail loudly and name every offending variable", () => {
  assert.throws(
    () => readEnv({ LOG_LEVEL: "loud", ALLOW_LOCAL_CREDENTIAL_FILES: "yes", APP_SECRET: "short" }),
    (e: unknown) => {
      assert.ok(e instanceof EnvError);
      for (const name of ["LOG_LEVEL", "ALLOW_LOCAL_CREDENTIAL_FILES", "APP_SECRET"])
        assert.match(e.message, new RegExp(name));
      return true;
    },
  );
});

test("startup validation requires a strong secret", () => {
  assert.throws(() => validateEnv({}), /APP_SECRET is required/);
  assert.throws(() => validateEnv({ APP_SECRET: "short" }), /APP_SECRET/);
  assert.equal(validateEnv({ APP_SECRET: "s".repeat(32) }).DATA_DIR, "./data");
});

test("process.env changes are picked up (the memo is keyed on the values)", () => {
  const saved = process.env.LOG_LEVEL;
  try {
    process.env.LOG_LEVEL = "debug";
    assert.equal(readEnv().LOG_LEVEL, "debug");
    process.env.LOG_LEVEL = "warn";
    assert.equal(readEnv().LOG_LEVEL, "warn");
  } finally {
    if (saved === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved;
  }
});

test("every setting is documented, and nothing documented is unknown", () => {
  const schemaKeys = Object.keys(envSchema.shape).sort();
  const documented = ENV_DOCS.map((d) => d.name as string).sort();
  assert.deepEqual(documented, schemaKeys);
  assert.ok(
    ENV_DOCS.every((d) => d.description.length > 10),
    "each setting needs a real description",
  );
  assert.equal(new Set(documented).size, documented.length, "no duplicate documentation rows");
});

test(".env.example is exactly what the code documents (run `npm run env:example` to regenerate)", () => {
  assert.equal(readFileSync(new URL("../../.env.example", import.meta.url), "utf8"), renderEnvExample());
});

test("docs/configuration.md is exactly what the code documents (run `npm run env:example` to regenerate)", () => {
  assert.equal(readFileSync(new URL("../../docs/configuration.md", import.meta.url), "utf8"), renderConfigDoc());
});

test("table cells escape backslashes before pipes", () => {
  assert.equal(escapeCell("a|b"), "a\\|b");
  assert.equal(escapeCell("a\\b"), "a\\\\b");
  assert.equal(escapeCell("a\\|b"), "a\\\\\\|b");
});
