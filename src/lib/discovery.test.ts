import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import type * as aws from "./aws";

vi.mock("./aws", async (importOriginal) => ({ ...(await importOriginal<typeof aws>()), run: vi.fn() }));

import { type Conn, run, serviceNames } from "./aws";
import { discover } from "./discovery";

const conn: Conn = { endpoint: "https://x", region: "us-east-1", accessKeyId: "a", secretAccessKey: "b" };
const runMock = vi.mocked(run);
beforeEach(() => runMock.mockReset());

const awsError = (name: string, message: string, status?: number) =>
  Object.assign(new Error(message), { name, ...(status ? { $metadata: { httpStatusCode: status } } : {}) });

test("probes every service and reports success as available", async () => {
  runMock.mockResolvedValue({});
  const probes = await discover(conn);
  assert.deepEqual(
    probes.map((p) => p.service),
    [...serviceNames],
  );
  assert.ok(probes.every((p) => p.available === true));
});

test("an unimplemented service is unsupported; other API errors still mean it exists", async () => {
  runMock.mockImplementation((_c, service) => {
    if (service === "kms") return Promise.reject(awsError("UnknownService", "could not resolve a target service"));
    if (service === "iam") return Promise.reject(awsError("Whatever", "gone", 404));
    if (service === "s3") return Promise.reject(awsError("AccessDenied", "nope", 403));
    return Promise.resolve({});
  });
  const by = new Map((await discover(conn)).map((p) => [p.service, p]));
  assert.equal(by.get("kms")?.available, false);
  assert.equal(by.get("iam")?.available, false);
  assert.equal(by.get("s3")?.available, true); // exists, just denied
  assert.match(by.get("s3")?.detail ?? "", /AccessDenied/);
  assert.equal(by.get("sqs")?.available, true);
});

test("network errors are retried, then reported as unknown", async () => {
  let kmsCalls = 0;
  runMock.mockImplementation((_c, service) => {
    if (service === "kms") {
      kmsCalls++;
      return Promise.reject(awsError("TimeoutError", "socket hang up"));
    }
    return Promise.resolve({});
  });
  const kms = (await discover(conn)).find((p) => p.service === "kms");
  assert.equal(kms?.available, null);
  assert.equal(kmsCalls, 3); // three attempts
});

test("a flaky service that recovers is reported available", async () => {
  let n = 0;
  runMock.mockImplementation((_c, service) => {
    if (service === "s3" && n++ < 2) return Promise.reject(awsError("TimeoutError", "ECONNRESET"));
    return Promise.resolve({});
  });
  assert.equal((await discover(conn)).find((p) => p.service === "s3")?.available, true);
});
