import assert from "node:assert/strict";

import { test } from "vitest";

import { hostAllowed } from "./host";

test("only local hosts pass the Host check, with or without a port", () => {
  for (const h of ["localhost:3000", "127.0.0.1:3000", "localhost", "[::1]:3000", "LOCALHOST:3000"])
    assert.equal(hostAllowed(h, {}), true, h);
  for (const h of ["evil.example.com", "evil.example.com:3000", "127.0.0.1.evil.com", "", null, undefined])
    assert.equal(hostAllowed(h, {}), false, String(h));
});

test("extra hosts can be allowed explicitly", () => {
  assert.equal(hostAllowed("console.lan:3000", { LOCAL_ALLOWED_HOSTS: "console.lan" }), true);
  assert.equal(hostAllowed("other.lan", { LOCAL_ALLOWED_HOSTS: "console.lan" }), false);
});
