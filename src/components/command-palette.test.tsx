import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { mockFetch, opOk, renderApp } from "../../tests/support/render";
import { CommandPalette } from "./command-palette";

const nav = vi.hoisted(() => ({ push: vi.fn(), path: "/t/t1/s3", setTheme: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => nav.path }));
vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: nav.setTheme }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  nav.push.mockClear();
  nav.setTheme.mockClear();
  nav.path = "/t/t1/s3";
  mockFetch([
    ["/ListBuckets", opOk({ Buckets: [{ Name: "assets" }, { Name: "logs" }] })],
    ["/ListTables", opOk({ TableNames: ["orders"] })],
    ["/api/targets", new Response(JSON.stringify([{ id: "t1", name: "Local" }]))],
    ["/api/fixtures", new Response(JSON.stringify([]))],
    ["/api/operations", new Response(JSON.stringify({ s3: ["PutObject"] }))],
    ["/", opOk({})],
  ]);
});

const open = () => renderApp(<CommandPalette open onOpenChange={vi.fn()} />);
const options = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("CommandPalette", () => {
  test("opens with quick navigation and actions, focused for typing", async () => {
    open();
    const input = await screen.findByRole("combobox", { name: "Search" });
    expect(input).toHaveFocus();
    expect(options().some((t) => t?.includes("DynamoDB"))).toBe(true);
    expect(options().some((t) => t?.includes("dark"))).toBe(true);
  });

  test("typing finds loaded resources", async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByRole("combobox"), "assets");
    await waitFor(() => expect(options().some((t) => t?.includes("assets"))).toBe(true));
  });

  test("Enter opens the highlighted result and remembers it as a recent", async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByRole("combobox"), "assets");
    await waitFor(() => expect(options()[0]).toContain("assets"));
    await user.keyboard("{Enter}");
    expect(nav.push).toHaveBeenCalledWith("/t/t1/s3/assets");
    expect(localStorage.getItem("palette:recent:v1")).toContain("assets");
  });

  test("arrow keys move the highlight and stop at the ends", async () => {
    const user = userEvent.setup();
    open();
    const input = await screen.findByRole("combobox");
    await user.type(input, "lo");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
    const selected = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);
    await user.keyboard("{ArrowDown}");
    expect(selected()).toBe(1);
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(selected()).toBe(0);
    await user.keyboard("{ArrowDown>40/}");
    expect(selected()).toBe(screen.getAllByRole("option").length - 1);
  });

  test("a theme action changes the theme instead of navigating", async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByRole("combobox"), "dark");
    await waitFor(() => expect(options()[0]).toMatch(/dark/i));
    await user.keyboard("{Enter}");
    expect(nav.setTheme).toHaveBeenCalledWith("dark");
    expect(nav.push).not.toHaveBeenCalled();
  });

  test("with no match it says so", async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByRole("combobox"), "zzzzqqq");
    expect(await screen.findByText(/Nothing matches “zzzzqqq”/)).toBeInTheDocument();
  });

  test("outside a target it still offers navigation to the workspace pages", async () => {
    nav.path = "/fixtures";
    open();
    await waitFor(() => expect(options()).toEqual(expect.arrayContaining([expect.stringMatching(/Targets/)])));
  });
});
