import { type QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useRecorder } from "@/components/recorder";

import { AppProviders, callInfo, mockFetch, newClient, opFail, opOk } from "../../tests/support/render";
import { callOp, OpError, useMutateOp, useOp, useRunOp } from "./aws-client";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  localStorage.clear();
  toast.error.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("callOp", () => {
  test("posts the input to the target-scoped runner and returns the output", async () => {
    const f = mockFetch([["/api/targets/T/s3/ListBuckets", opOk({ Buckets: [] })]]);
    expect(await callOp("T", "s3", "ListBuckets", { a: 1 })).toEqual({ Buckets: [] });
    expect(callInfo(f)).toEqual({ url: "/api/targets/T/s3/ListBuckets", method: "POST", body: { a: 1 } });
  });

  test("the region travels as an encoded query parameter", async () => {
    const f = mockFetch([["/api/", opOk({})]]);
    await callOp("T", "sqs", "ListQueues", {}, "eu-west-1");
    expect(callInfo(f).url).toBe("/api/targets/T/sqs/ListQueues?region=eu-west-1");
  });

  test("an AWS error keeps its name and status", async () => {
    mockFetch([["/api/", opFail("NoSuchBucket", "The bucket does not exist", 404)]]);
    await expect(callOp("T", "s3", "HeadBucket", {})).rejects.toMatchObject({
      message: "The bucket does not exist",
      awsName: "NoSuchBucket",
      status: 404,
    });
  });

  test("an HTTP-level failure surfaces the server's message (or the status)", async () => {
    mockFetch([
      ["/Forbidden", new Response(JSON.stringify({ error: "not signed in" }), { status: 401 })],
      ["/Broken", new Response("<html>", { status: 502 })],
    ]);
    await expect(callOp("T", "s3", "Forbidden")).rejects.toThrow("not signed in");
    await expect(callOp("T", "s3", "Broken")).rejects.toThrow("HTTP 502");
    await expect(callOp("T", "s3", "Broken")).rejects.toBeInstanceOf(OpError);
  });
});

describe("useOp", () => {
  test("loads data, caches it per input and region", async () => {
    const f = mockFetch([["/ListTables", opOk({ TableNames: ["a"] })]]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppProviders region="us-east-1">{children}</AppProviders>
    );
    const { result } = renderHook(() => useOp<{ TableNames: string[] }>("dynamodb", "ListTables"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ TableNames: ["a"] }));
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("an error is exposed, not thrown", async () => {
    mockFetch([["/", opFail("AccessDenied", "denied", 403)]]);
    const { result } = renderHook(() => useOp("s3", "ListBuckets"), {
      wrapper: ({ children }) => <AppProviders>{children}</AppProviders>,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("denied");
  });
});

describe("useMutateOp", () => {
  function setup(client = newClient()) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppProviders client={client}>{children}</AppProviders>
    );
    return { client, wrapper };
  }
  const withRecorder =
    <T,>(hook: () => T) =>
    () => ({ hook: hook(), recorder: useRecorder() });

  test("a successful write invalidates the whole service and is recorded for fixtures", async () => {
    mockFetch([["/CreateBucket", opOk({})]]);
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      withRecorder(() => useMutateOp("s3", "CreateBucket")),
      { wrapper },
    );
    await act(() => result.current.hook.mutateAsync({ Bucket: "b" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["t1", "s3"] });
    expect(result.current.recorder.steps).toEqual([
      { service: "s3", operation: "CreateBucket", input: { Bucket: "b" }, region: "us-east-1" },
    ]);
  });

  test("reads and Invoke are never recorded; record:false opts out", async () => {
    mockFetch([["/", opOk({})]]);
    const { wrapper } = setup();
    const { result } = renderHook(
      withRecorder(() => ({
        read: useMutateOp("sqs", "ReceiveMessage"),
        invoke: useMutateOp("lambda", "Invoke"),
        quiet: useMutateOp("sqs", "DeleteMessage", { record: false }),
        write: useMutateOp("sqs", "SendMessage"),
      })),
      { wrapper },
    );
    await act(async () => {
      await result.current.hook.read.mutateAsync({});
      await result.current.hook.invoke.mutateAsync({});
      await result.current.hook.quiet.mutateAsync({});
      await result.current.hook.write.mutateAsync({ MessageBody: "x" });
    });
    expect(result.current.recorder.steps.map((s) => s.operation)).toEqual(["SendMessage"]);
  });

  test("a failure toasts the message (unless silent), records nothing and does not invalidate", async () => {
    mockFetch([["/", opFail("QueueDoesNotExist", "no such queue")]]);
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      withRecorder(() => ({
        loud: useMutateOp("sqs", "SendMessage"),
        silent: useMutateOp("sqs", "SendMessage", { silentError: true }),
      })),
      { wrapper },
    );
    await act(async () => {
      await expect(result.current.hook.loud.mutateAsync({})).rejects.toThrow("no such queue");
      await expect(result.current.hook.silent.mutateAsync({})).rejects.toThrow();
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("no such queue");
    expect(result.current.recorder.steps).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("invalidate can target other services (e.g. a table write also refreshes the table list)", async () => {
    mockFetch([["/", opOk({})]]);
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMutateOp("dynamodb", "PutItem", { invalidate: ["dynamodb", "s3"] }), {
      wrapper,
    });
    await act(() => result.current.mutateAsync({}));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["t1", "dynamodb"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["t1", "s3"] });
  });
});

describe("useRunOp", () => {
  test("runs sequential calls with the same recording and invalidation rules", async () => {
    mockFetch([["/", opOk({ UploadId: "u1" })]]);
    const client: QueryClient = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => ({ run: useRunOp(), recorder: useRecorder() }), {
      wrapper: ({ children }) => <AppProviders client={client}>{children}</AppProviders>,
    });
    expect(await act(() => result.current.run("s3", "CreateMultipartUpload", { Bucket: "b" }))).toEqual({
      UploadId: "u1",
    });
    await act(() => result.current.run("s3", "ListObjectsV2", {}));
    await act(() => result.current.run("s3", "PutObject", {}, { record: false, invalidate: false }));
    expect(result.current.recorder.steps.map((s) => s.operation)).toEqual(["CreateMultipartUpload"]);
    expect(invalidate).toHaveBeenCalledTimes(2); // the third call asked not to
  });
});
