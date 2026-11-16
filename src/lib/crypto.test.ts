import assert from "node:assert/strict";

import { test } from "vitest";

import { decrypt, encrypt } from "./crypto";

process.env.APP_SECRET = "x".repeat(40);

test("encrypt/decrypt round trip, with a fresh IV each time", () => {
  const a = encrypt("s3cr3t");
  assert.notEqual(a, encrypt("s3cr3t"));
  assert.equal(decrypt(a), "s3cr3t");
});

test("tampered ciphertext is rejected", () => {
  const blob = encrypt("s3cr3t");
  const bad = blob.slice(0, -2) + (blob.endsWith("AA") ? "BB" : "AA");
  assert.throws(() => decrypt(bad));
});

test("a different APP_SECRET cannot decrypt", () => {
  const blob = encrypt("s3cr3t");
  process.env.APP_SECRET = "y".repeat(40);
  assert.throws(() => decrypt(blob));
  process.env.APP_SECRET = "x".repeat(40);
});
