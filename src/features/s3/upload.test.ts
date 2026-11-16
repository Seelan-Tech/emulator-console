// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { downloadUrl, uploadFile } from "./upload";

class FakeXHR {
  static last: FakeXHR;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
  }
  finish(status: number, text = "") {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

beforeEach(() => void vi.stubGlobal("XMLHttpRequest", FakeXHR));
afterEach(() => vi.unstubAllGlobals());

const file = (name = "a b.txt", type = "text/plain") => new File(["hello"], name, { type });

test("uploads PUT the raw file with its content type to the target-scoped route", () => {
  const f = file();
  void uploadFile({
    tid: "T1",
    region: "eu-west-1",
    bucket: "my-bucket",
    key: "dir/a b.txt",
    file: f,
    onProgress: () => {},
  });
  const x = FakeXHR.last;
  assert.equal(x.method, "PUT");
  assert.equal(x.url, "/api/targets/T1/s3/_upload?bucket=my-bucket&key=dir%2Fa+b.txt&region=eu-west-1");
  assert.equal(x.headers["content-type"], "text/plain");
  assert.equal(x.sent, f);
});

test("a file without a type is sent as application/octet-stream", () => {
  void uploadFile({
    tid: "T",
    bucket: "b",
    key: "k",
    file: new File(["x"], "blob", { type: "" }),
    onProgress: () => {},
  });
  assert.equal(FakeXHR.last.headers["content-type"], "application/octet-stream");
});

test("progress is reported, and success resolves", async () => {
  const seen: [number, number][] = [];
  const h = uploadFile({ tid: "T", bucket: "b", key: "k", file: file(), onProgress: (l, t) => void seen.push([l, t]) });
  FakeXHR.last.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
  FakeXHR.last.upload.onprogress?.({ lengthComputable: false, loaded: 9, total: 0 }); // ignored
  FakeXHR.last.finish(200, '{"ok":true}');
  await h.promise;
  assert.deepEqual(seen, [[5, 10]]);
});

test("a server error surfaces its message; a non-JSON error falls back to the status", async () => {
  const a = uploadFile({ tid: "T", bucket: "b", key: "k", file: file(), onProgress: () => {} });
  FakeXHR.last.finish(502, '{"error":"bucket is full"}');
  await assert.rejects(a.promise, /bucket is full/);
  const b = uploadFile({ tid: "T", bucket: "b", key: "k", file: file(), onProgress: () => {} });
  FakeXHR.last.finish(500, "<html>oops</html>");
  await assert.rejects(b.promise, /upload failed \(500\)/);
});

test("network failures and cancellation reject with a clear message", async () => {
  const a = uploadFile({ tid: "T", bucket: "b", key: "k", file: file(), onProgress: () => {} });
  FakeXHR.last.onerror?.();
  await assert.rejects(a.promise, /network error/);
  const b = uploadFile({ tid: "T", bucket: "b", key: "k", file: file(), onProgress: () => {} });
  b.abort();
  await assert.rejects(b.promise, /cancelled/);
});

test("downloadUrl encodes the key and supports region and inline view", () => {
  assert.equal(downloadUrl("T", "bkt", "a/b c.txt"), "/api/targets/T/s3/_download?bucket=bkt&key=a%2Fb+c.txt");
  assert.equal(
    downloadUrl("T", "bkt", "k", { region: "us-west-2", inline: true }),
    "/api/targets/T/s3/_download?bucket=bkt&key=k&region=us-west-2&inline=1",
  );
});
