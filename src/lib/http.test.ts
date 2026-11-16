import assert from "node:assert/strict";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { z } from "zod";

import { body, clientIp, errorResponse, HttpError, json, route, sdkJson } from "./http";

beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const req = (method: string, headers: Record<string, string> = {}, url = "http://app.test/x", data?: unknown) =>
  new NextRequest(url, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });

async function parse(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("sdkJson shows small text bytes as strings, binary as a size, and bigint as a string", async () => {
  const res = sdkJson({
    text: new TextEncoder().encode("hello"),
    bin: new Uint8Array([0xff, 0xfe, 0x00]),
    zero: new Uint8Array([104, 0, 105]),
    big: 12345678901234567890n,
    keep: { n: 1 },
  });
  assert.deepEqual((await res.json()) as unknown, {
    text: "hello",
    bin: "<3 bytes>",
    zero: "<3 bytes>",
    big: "12345678901234567890",
    keep: { n: 1 },
  });
});

test("sdkJson reports very large byte arrays by size without decoding them", async () => {
  const big = new Uint8Array(1024 * 1024 + 1).fill(65);
  assert.deepEqual((await sdkJson({ big }).json()) as unknown, { big: `<${big.length} bytes>` });
});

test("clientIp takes the first X-Forwarded-For hop, else 'local'", () => {
  assert.equal(clientIp(req("GET", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp(req("GET", { "x-forwarded-for": "  198.51.100.4  " })), "198.51.100.4");
  assert.equal(clientIp(req("GET")), "local");
  assert.equal(clientIp(req("GET", { "x-forwarded-for": "" })), "local");
});

test("errorResponse maps each error type to a status and message", async () => {
  assert.deepEqual(await parse(errorResponse(new HttpError(409, "dup", "conflict"))), {
    status: 409,
    body: { error: "dup", code: "conflict" },
  });
  assert.deepEqual(await parse(errorResponse(new HttpError(404, "nope"))), { status: 404, body: { error: "nope" } });
  const zodErr = z.object({ n: z.number() }).safeParse({ n: "x" }).error!;
  const z400 = await parse(errorResponse(zodErr));
  assert.equal(z400.status, 400);
  assert.match(String(z400.body.error), /^n: /);
  assert.deepEqual(await parse(errorResponse(new SyntaxError("bad json"))), {
    status: 400,
    body: { error: "invalid JSON body" },
  });
  const unknown = await parse(errorResponse(new Error("secret internals")));
  assert.deepEqual(unknown, { status: 500, body: { error: "internal error" } }); // internals are never leaked
});

test("body() validates with the schema", async () => {
  const schema = z.object({ name: z.string() });
  assert.deepEqual(await body(req("POST", {}, "http://app.test/x", { name: "a" }), schema), { name: "a" });
  await assert.rejects(body(req("POST", {}, "http://app.test/x", { name: 1 }), schema));
});

test("route() passes resolved params and converts thrown errors", async () => {
  const ok = route<{ id: string }>(async (_r, p) => json({ id: p.id }));
  assert.deepEqual(await parse(await ok(req("GET"), { params: Promise.resolve({ id: "7" }) })), {
    status: 200,
    body: { id: "7" },
  });
  const bad = route(async () => {
    throw new HttpError(403, "no");
  });
  assert.deepEqual(await parse(await bad(req("GET"), { params: Promise.resolve({}) })), {
    status: 403,
    body: { error: "no" },
  });
});

test("route() blocks state-changing requests from another origin (CSRF), but not same-origin or reads", async () => {
  const handler = route(async () => json({ ok: true }));
  const ctx = { params: Promise.resolve({}) };
  const cross = await parse(await handler(req("POST", { origin: "https://evil.example", host: "app.test" }), ctx));
  assert.deepEqual(cross, { status: 403, body: { error: "cross-origin request blocked" } });
  assert.equal((await handler(req("POST", { origin: "http://app.test", host: "app.test" }), ctx)).status, 200);
  assert.equal((await handler(req("POST", { host: "app.test" }), ctx)).status, 200); // non-browser client: no Origin header
  assert.equal((await handler(req("GET", { origin: "https://evil.example", host: "app.test" }), ctx)).status, 200);
  // behind a proxy the original host is in X-Forwarded-Host
  assert.equal(
    (
      await handler(
        req("PUT", { origin: "https://console.example", host: "internal:3000", "x-forwarded-host": "console.example" }),
        ctx,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handler(
        req("DELETE", { origin: "https://evil.example", host: "internal:3000", "x-forwarded-host": "console.example" }),
        ctx,
      )
    ).status,
    403,
  );
});
