import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { mockFetch, posted, renderApp } from "../../tests/support/render";
import { RestartBanner, type TargetStatus } from "./restart-banner";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const status = (over: Partial<TargetStatus> = {}): TargetStatus => ({
  canDetect: true,
  emulator: null,
  restartedAt: new Date(Date.now() - 60_000).toISOString(),
  bannerVisible: true,
  baseline: null,
  autoReplay: false,
  lastRun: null,
  ...over,
});
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const run = (over: Partial<NonNullable<TargetStatus["lastRun"]>>): NonNullable<TargetStatus["lastRun"]> => ({
  id: "r1",
  status: "succeeded",
  trigger: "restart",
  startedAt: new Date().toISOString(),
  fixtureName: "seed",
  steps: 3,
  failedStep: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  toast.error.mockClear();
  toast.success.mockClear();
});

describe("RestartBanner", () => {
  test("is absent when no restart needs attention", async () => {
    const f = mockFetch([["/status", json(status({ bannerVisible: false }))]]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.queryByTestId("restart-banner")).not.toBeInTheDocument();
  });

  test("without a baseline it offers to choose one without leaving the page", async () => {
    const user = userEvent.setup();
    const onChooseBaseline = vi.fn();
    mockFetch([["/status", json(status())]]);
    renderApp(<RestartBanner onChooseBaseline={onChooseBaseline} />);
    expect(await screen.findByText(/Its state was reset\. Set a baseline fixture/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Choose a baseline" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose a baseline" }));
    expect(onChooseBaseline).toHaveBeenCalledOnce();
  });

  test("with a baseline it offers a one-click replay, then reports success", async () => {
    const user = userEvent.setup();
    const f = mockFetch([
      ["/baseline/replay", json({ status: "succeeded" })],
      ["/status", json(status({ baseline: { id: "f1", name: "seed" } }))],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Replay “seed”/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Baseline “seed” replayed"));
    expect(posted(f, "/baseline/replay")).toBe(true);
  });

  test("a failed manual replay is reported", async () => {
    const user = userEvent.setup();
    mockFetch([
      ["/baseline/replay", json({ status: "failed" })],
      ["/status", json(status({ baseline: { id: "f1", name: "seed" } }))],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Replay/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Baseline replay failed"));
  });

  test("dismiss acknowledges the restart", async () => {
    const user = userEvent.setup();
    const f = mockFetch([
      ["/restart/ack", json({ ok: true })],
      ["/status", json(status())],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Dismiss/ }));
    await waitFor(() => expect(posted(f, "/restart/ack")).toBe(true));
  });

  test("auto replay in progress shows a spinner message and no actions", async () => {
    mockFetch([
      [
        "/status",
        json(status({ autoReplay: true, baseline: { id: "f1", name: "seed" }, lastRun: run({ status: "running" }) })),
      ],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    expect(await screen.findByText(/Replaying baseline/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("auto replay success says the state was restored", async () => {
    mockFetch([
      ["/status", json(status({ autoReplay: true, baseline: { id: "f1", name: "seed" }, lastRun: run({}) }))],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    expect(await screen.findByText(/state restored/)).toBeInTheDocument();
    expect(screen.getByText(/replayed \(3\s+steps\)/)).toBeInTheDocument();
  });

  test("auto replay failure names the failing step and offers retry", async () => {
    mockFetch([
      [
        "/status",
        json(
          status({
            autoReplay: true,
            baseline: { id: "f1", name: "seed" },
            lastRun: run({ status: "failed", failedStep: { index: 2, operation: "CreateQueue", error: "boom" } }),
          }),
        ),
      ],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    expect(await screen.findByText(/at step 2 \(CreateQueue\): boom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  test("a run from before the restart is not treated as the restart's replay", async () => {
    mockFetch([
      [
        "/status",
        json(
          status({
            autoReplay: true,
            baseline: { id: "f1", name: "seed" },
            lastRun: run({ startedAt: new Date(Date.now() - 3_600_000).toISOString() }),
          }),
        ),
      ],
    ]);
    renderApp(<RestartBanner onChooseBaseline={() => {}} />);
    expect(await screen.findByRole("button", { name: /Replay “seed”/ })).toBeInTheDocument();
    expect(screen.queryByText(/state restored/)).not.toBeInTheDocument();
  });
});
