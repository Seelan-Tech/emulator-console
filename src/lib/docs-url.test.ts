import assert from "node:assert/strict";

import { test } from "vitest";

import { docsUrl } from "./docs-url";

const repo = "https://github.com/Seelan-Tech/emulator-console";

test("the guide of a released version is read at its tag", () => {
  assert.equal(docsUrl("0.2.0"), `${repo}/tree/v0.2.0/docs`);
  assert.equal(docsUrl("1.4.0-rc.1"), `${repo}/tree/v1.4.0-rc.1/docs`);
});

test("an unknown or malformed version reads main", () => {
  assert.equal(docsUrl(undefined), `${repo}/tree/main/docs`);
  assert.equal(docsUrl(""), `${repo}/tree/main/docs`);
  assert.equal(docsUrl("dev"), `${repo}/tree/main/docs`);
  assert.equal(docsUrl("0.2"), `${repo}/tree/main/docs`);
});

test("DOCS_URL wins over the version", () => {
  assert.equal(docsUrl("0.2.0", "https://docs.example.com/x"), "https://docs.example.com/x");
});
