import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { crc32, makeZip, toBase64 } from "./zip";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("toBase64 handles large inputs", () => {
  const big = new Uint8Array(200_000).fill(65);
  assert.equal(Buffer.from(toBase64(big), "base64").length, 200_000);
});

test("python's zipfile can read the archive we build (name, content and unix permissions)", ({ skip }) => {
  try {
    execFileSync("python3", ["--version"]);
  } catch {
    return skip("python3 not available");
  }
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const file = join(dir, "x.zip");
  writeFileSync(file, makeZip("index.py", "def handler(e, c):\n    return {'ok': 1}\n"));
  const out = execFileSync("python3", [
    "-c",
    `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
i = z.getinfo("index.py")
print(z.read("index.py").decode().splitlines()[0], oct(i.external_attr >> 16))`,
    file,
  ])
    .toString()
    .trim();
  assert.equal(out, "def handler(e, c): 0o100644");
});
