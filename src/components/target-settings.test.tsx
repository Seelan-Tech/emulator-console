import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { callInfo, mockFetch, newClient, renderApp } from "../../tests/support/render";
import { TargetSettings } from "./target-settings";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body));
const saved = { id: "t1", name: "Local", baselineFixtureId: null, autoReplay: false, canDetectRestart: true };

// The fixtures answer first, the saved settings later.
function lateSettings(settings: unknown) {
  let release!: () => void;
  const late = new Promise<void>((r) => (release = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/fixtures"))
        return json([
          { id: "f1", name: "seed" },
          { id: "f2", name: "other" },
        ]);
      if (url.endsWith("/api/targets/t1")) {
        await late;
        return json(settings);
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return release;
}
const autoSwitch = () => screen.getByRole("switch", { name: "Replay automatically after a restart" });

describe("TargetSettings", () => {
  test("choosing the baseline before the saved settings arrive still loads the saved automatic replay", async () => {
    const user = userEvent.setup();
    const release = lateSettings({ ...saved, baselineFixtureId: "f1", autoReplay: true });
    renderApp(<TargetSettings targetId="t1" open onOpenChange={() => {}} />);
    await screen.findByRole("option", { name: "seed" });
    await user.selectOptions(screen.getByLabelText("Baseline fixture"), "f1");
    release();
    await waitFor(() => expect(autoSwitch()).toBeChecked());
    expect(screen.getByLabelText("Baseline fixture")).toHaveValue("f1");
  });

  test("a baseline picked early is kept, and the saved automatic replay still applies to it", async () => {
    const user = userEvent.setup();
    const release = lateSettings({ ...saved, baselineFixtureId: "f1", autoReplay: true });
    renderApp(<TargetSettings targetId="t1" open onOpenChange={() => {}} />);
    await screen.findByRole("option", { name: "other" });
    await user.selectOptions(screen.getByLabelText("Baseline fixture"), "f2");
    release();
    await waitFor(() => expect(autoSwitch()).toBeChecked());
    expect(screen.getByLabelText("Baseline fixture")).toHaveValue("f2");
  });

  test("a switch the user flipped is not overwritten when the saved settings are fetched again", async () => {
    const user = userEvent.setup();
    const client = newClient();
    let name = "Local";
    mockFetch([
      ["/api/fixtures", json([{ id: "f1", name: "seed" }])],
      [/\/api\/targets\/t1$/, () => json({ ...saved, name, baselineFixtureId: "f1", autoReplay: true })],
    ]);
    renderApp(<TargetSettings targetId="t1" open onOpenChange={() => {}} />, { client });
    await waitFor(() => expect(autoSwitch()).toBeChecked());
    await user.click(autoSwitch());
    expect(autoSwitch()).not.toBeChecked();
    name = "Renamed"; // the refetch brings new data, so the form's effect runs again
    await client.invalidateQueries({ queryKey: ["target", "t1"] });
    await waitFor(() => expect(client.getQueryData<{ name: string }>(["target", "t1"])?.name).toBe("Renamed"));
    expect(autoSwitch()).not.toBeChecked(); // the user's choice, not the saved true
  });

  test("a choice made before the saved settings arrive is not overwritten by them", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/fixtures")) return json([{ id: "f1", name: "seed" }]);
      if (url.endsWith("/api/targets/t1")) {
        await late; // the saved settings arrive after the fixtures
        return json(saved);
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", f);
    renderApp(<TargetSettings targetId="t1" open onOpenChange={() => {}} />);

    await screen.findByRole("option", { name: "seed" }); // the fixtures arrived; the saved settings have not
    await user.selectOptions(screen.getByLabelText("Baseline fixture"), "f1");
    release();
    const auto = screen.getByRole("switch", { name: "Replay automatically after a restart" });
    await waitFor(() => expect(auto).toBeEnabled()); // needs a baseline and a detectable target
    expect(screen.getByLabelText("Baseline fixture")).toHaveValue("f1");
  });

  test("saved settings fill the form and save sends the changes", async () => {
    const user = userEvent.setup();
    const f = mockFetch([
      ["/api/fixtures", json([{ id: "f1", name: "seed" }])],
      [
        /\/api\/targets\/t1$/,
        (_u: string, init?: RequestInit) =>
          init?.method === "PATCH" ? json({}) : json({ ...saved, baselineFixtureId: "f1" }),
      ],
    ]);
    renderApp(<TargetSettings targetId="t1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Baseline fixture")).toHaveValue("f1"));
    await user.click(screen.getByRole("switch", { name: "Replay automatically after a restart" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const at = f.mock.calls.findIndex(([, init]) => init?.method === "PATCH");
    expect(callInfo(f, at).body).toEqual({ baselineFixtureId: "f1", autoReplay: true });
  });
});
