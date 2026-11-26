import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { callInfo, mockFetch, renderApp } from "../../tests/support/render";
import { RecorderDrawer, RecorderProvider, useRecorder } from "./recorder";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RecorderProvider targetId="t1">{children}</RecorderProvider>
);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("useRecorder", () => {
  test("records steps and adds the replay timing a restarted emulator needs", () => {
    const { result } = renderHook(() => useRecorder(), { wrapper });
    act(() => result.current.add({ service: "dynamodb", operation: "CreateTable", input: { TableName: "t" } }));
    act(() => result.current.add({ service: "dynamodb", operation: "PutItem", input: {} }));
    act(() => result.current.add({ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }));
    const [table, put, bucket] = result.current.steps;
    expect(table?.delayAfterMs).toBe(3000); // wait for ACTIVE before the next step
    expect(put?.retries).toBe(5); // the table may still be CREATING
    expect(bucket).toEqual({ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } });
  });

  test("a paused recorder ignores new steps", () => {
    const { result } = renderHook(() => useRecorder(), { wrapper });
    act(() => result.current.setRecording(false));
    act(() => result.current.add({ service: "s3", operation: "CreateBucket", input: {} }));
    expect(result.current.steps).toHaveLength(0);
    act(() => result.current.setRecording(true));
    act(() => result.current.add({ service: "s3", operation: "CreateBucket", input: {} }));
    expect(result.current.steps).toHaveLength(1);
  });

  test("remove and clear", () => {
    const { result } = renderHook(() => useRecorder(), { wrapper });
    for (const n of ["A", "B", "C"])
      act(() => result.current.add({ service: "s3", operation: `Create${n}`, input: {} }));
    act(() => result.current.remove(1));
    expect(result.current.steps.map((s) => s.operation)).toEqual(["CreateA", "CreateC"]);
    act(() => result.current.clear());
    expect(result.current.steps).toEqual([]);
  });

  test("steps and the pause switch survive a reload, per target", async () => {
    const first = renderHook(() => useRecorder(), { wrapper });
    act(() => first.result.current.add({ service: "sqs", operation: "CreateQueue", input: { QueueName: "q" } }));
    act(() => first.result.current.setRecording(false));
    first.unmount();

    const again = renderHook(() => useRecorder(), { wrapper });
    await waitFor(() => expect(again.result.current.steps).toHaveLength(1));
    expect(again.result.current.steps[0]?.input).toEqual({ QueueName: "q" });
    expect(again.result.current.recording).toBe(false);

    // a different target starts empty
    const other = renderHook(() => useRecorder(), {
      wrapper: ({ children }) => <RecorderProvider targetId="t2">{children}</RecorderProvider>,
    });
    expect(other.result.current.steps).toEqual([]);
  });

  test("corrupt saved state is ignored rather than crashing", () => {
    localStorage.setItem("recorder:v1:t1", "{not json");
    const { result } = renderHook(() => useRecorder(), { wrapper });
    expect(result.current.steps).toEqual([]);
  });
});

const URL = "http://localhost:9297/000000000000/orders";
const createQueue = { service: "sqs", operation: "CreateQueue", input: { QueueName: "orders" } } as const;
const sendMessage = { service: "sqs", operation: "SendMessage", input: { QueueUrl: URL, MessageBody: "hi" } } as const;

describe("linking ids between steps", () => {
  test("an id a call returned and a later call uses becomes a variable, and can be unlinked", () => {
    const { result } = renderHook(() => useRecorder(), { wrapper });
    act(() => result.current.add(createQueue, { QueueUrl: URL }));
    act(() => result.current.add(sendMessage, {}));
    const [queue, send] = result.current.steps;
    expect(queue?.capture).toEqual({ queueUrl: "QueueUrl" });
    expect(send?.input).toEqual({ QueueUrl: "{{queueUrl}}", MessageBody: "hi" });

    act(() => result.current.unlink(1, "queueUrl"));
    expect(result.current.steps[1]?.input).toEqual(sendMessage.input);
    expect(result.current.steps[0]?.capture).toBeUndefined();
  });

  test("it can be switched off, and the choice survives a reload", async () => {
    const first = renderHook(() => useRecorder(), { wrapper });
    act(() => first.result.current.setLinkIds(false));
    act(() => first.result.current.add(createQueue, { QueueUrl: URL }));
    act(() => first.result.current.add(sendMessage, {}));
    expect(first.result.current.steps[1]?.input).toEqual(sendMessage.input);
    first.unmount();
    const again = renderHook(() => useRecorder(), { wrapper });
    await waitFor(() => expect(again.result.current.linkIds).toBe(false));
  });

  test("removing the step that returned the id gives the later step its value back", () => {
    const { result } = renderHook(() => useRecorder(), { wrapper });
    act(() => result.current.add(createQueue, { QueueUrl: URL }));
    act(() => result.current.add(sendMessage, {}));
    act(() => result.current.remove(0));
    expect(result.current.steps).toHaveLength(1);
    expect(result.current.steps[0]?.input).toEqual(sendMessage.input);
  });
});

describe("RecorderDrawer", () => {
  function Linked() {
    const r = useRecorder();
    return (
      <button
        onClick={() => {
          r.add(createQueue, { QueueUrl: URL });
          r.add(sendMessage, {});
        }}
      >
        record linked
      </button>
    );
  }

  test("shows which steps keep and use a value, unlinks on request, and saves a clean fixture", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      [
        /\/api\/fixtures$/,
        (_u: string, init?: RequestInit) => (init?.method === "POST" ? { id: "f1", name: "n" } : []),
      ],
    ]);
    renderApp(
      <>
        <Linked />
        <RecorderDrawer />
      </>,
    );
    await user.click(screen.getByText("record linked"));
    await user.click(screen.getByRole("button", { name: "Steps" }));
    expect(screen.getByText("keeps queueUrl")).toBeInTheDocument();
    expect(screen.getByText("uses queueUrl")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save as fixture/i }));
    await user.type(await screen.findByPlaceholderText("Fixture name"), "n");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("recorder-count")).toHaveTextContent("0 steps"));
    const at = fetchMock.mock.calls.findIndex(([, init]) => init?.method === "POST");
    const sent = callInfo(fetchMock, at).body as { steps: Record<string, unknown>[] };
    expect(sent.steps[0]).toEqual({ ...createQueue, capture: { queueUrl: "QueueUrl" } });
    expect(sent.steps[1]).toEqual({ ...sendMessage, input: { QueueUrl: "{{queueUrl}}", MessageBody: "hi" } });
  });

  test("the unlink button on a step puts the value back", async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <Linked />
        <RecorderDrawer />
      </>,
    );
    await user.click(screen.getByText("record linked"));
    await user.click(screen.getByRole("button", { name: "Steps" }));
    await user.click(screen.getByRole("button", { name: "Unlink queueUrl in step 2" }));
    expect(screen.queryByText("uses queueUrl")).not.toBeInTheDocument();
    expect(screen.queryByText("keeps queueUrl")).not.toBeInTheDocument();
  });

  function Seed({ n }: { n: number }) {
    const r = useRecorder();
    return (
      <button
        onClick={() => {
          for (let i = 0; i < n; i++)
            r.add({ service: "s3", operation: `CreateBucket${i}`, input: { Bucket: `b${i}` } });
        }}
      >
        seed
      </button>
    );
  }

  test("shows the step count and lets the user pause recording", async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <Seed n={2} />
        <RecorderDrawer />
      </>,
    );
    expect(screen.getByTestId("recorder-count")).toHaveTextContent("0 steps");
    await user.click(screen.getByText("seed"));
    expect(screen.getByTestId("recorder-count")).toHaveTextContent("2 steps");
    expect(screen.getByRole("switch", { name: /record/i })).toBeChecked();
    await user.click(screen.getByRole("switch", { name: /record/i }));
    expect(screen.getByRole("switch", { name: /record/i })).not.toBeChecked();
  });

  test("saving as a new fixture posts the steps and clears the recorder", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      [
        /\/api\/fixtures$/,
        (_u: string, init?: RequestInit) => (init?.method === "POST" ? { id: "f1", name: "my fixture" } : []),
      ],
    ]);
    renderApp(
      <>
        <Seed n={2} />
        <RecorderDrawer />
      </>,
    );
    await user.click(screen.getByText("seed"));
    await user.click(screen.getByRole("button", { name: /save as fixture/i }));
    await user.type(await screen.findByPlaceholderText("Fixture name"), "my fixture");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("recorder-count")).toHaveTextContent("0 steps"));
    const at = fetchMock.mock.calls.findIndex(([, init]) => init?.method === "POST");
    const sent = callInfo(fetchMock, at).body as { name: string; steps: { operation: string }[] };
    expect(sent.name).toBe("my fixture");
    expect(sent.steps.map((s) => s.operation)).toEqual(["CreateBucket0", "CreateBucket1"]);
  });

  test("the Save button needs a name for a new fixture", async () => {
    const user = userEvent.setup();
    mockFetch([[/fixtures$/, []]]);
    renderApp(
      <>
        <Seed n={1} />
        <RecorderDrawer />
      </>,
    );
    await user.click(screen.getByText("seed"));
    await user.click(screen.getByRole("button", { name: /save as fixture/i }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("with nothing recorded there is no save or clear action", () => {
    renderApp(<RecorderDrawer />);
    expect(screen.getByTestId("recorder-count")).toHaveTextContent("0 steps");
    expect(screen.queryByRole("button", { name: /save as fixture/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });
});
