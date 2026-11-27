import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { callInfo, mockFetch, opOk, renderApp } from "../../../tests/support/render";
import { EventBuses } from "./buses";
import { EventRuleView } from "./rule-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// CodeMirror cannot be laid out by jsdom; a textarea stands in for it.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="editor" value={value} readOnly />,
  EditorView: { contentAttributes: { of: () => [] } },
}));
afterEach(() => vi.unstubAllGlobals());

const RULE = "arn:aws:events:us-east-1:000000000000:rule/orders/audit";
const QUEUE = "arn:aws:sqs:us-east-1:000000000000:audit-q";

describe("EventBuses", () => {
  test("lists the buses with their rule counts, and the default one cannot be deleted", async () => {
    mockFetch([
      [
        "/ListEventBuses",
        opOk({
          EventBuses: [
            { Name: "orders", Arn: "arn:aws:events:us-east-1:0:event-bus/orders" },
            { Name: "default", Arn: "arn:aws:events:us-east-1:0:event-bus/default" },
          ],
        }),
      ],
      [
        "/ListRules",
        (_u: string, init?: RequestInit) =>
          opOk({
            Rules:
              (JSON.parse(init?.body as string) as { EventBusName: string }).EventBusName === "orders" ? [{}, {}] : [],
          }),
      ],
    ]);
    renderApp(<EventBuses />);
    const row = async (name: string) => (await screen.findByRole("link", { name })).closest("tr")!;
    expect(within(await row("orders")).getByText("2")).toBeInTheDocument();
    // the default bus comes first, and has no working delete button
    const names = screen.getAllByRole("link").map((l) => l.textContent);
    expect(names.indexOf("default")).toBeLessThan(names.indexOf("orders"));
    expect(screen.getByRole("button", { name: "Delete event bus default" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete event bus orders" })).toBeEnabled();
  });
});

describe("EventRuleView", () => {
  function routes() {
    return mockFetch([
      [
        "/eventbridge/DescribeRule",
        opOk({
          Name: "audit",
          Arn: RULE,
          EventPattern: '{"source":["shop"]}',
          State: "ENABLED",
          Description: "Audit trail",
        }),
      ],
      ["/eventbridge/ListTargetsByRule", opOk({ Targets: [{ Id: "audit-q", Arn: QUEUE }] })],
      ["/sqs/GetQueueUrl", opOk({ QueueUrl: "http://e/000000000000/audit-q" })],
      [
        "/sqs/GetQueueAttributes",
        opOk({
          Attributes: {
            Policy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "keep", Effect: "Allow" }] }),
          },
        }),
      ],
      ["/sqs/SetQueueAttributes", opOk({})],
    ]);
  }

  test("a queue target that does not allow the rule needs permission, and Fix adds the statement and keeps the rest", async () => {
    const fetch = routes();
    renderApp(<EventRuleView bus="orders" rule="audit" />);
    const row = (await screen.findByText("audit-q", { selector: "a" })).closest("tr")!;
    expect(await within(row).findByText("needs permission")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Targets \(1, 1 need attention\)/ })).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Fix" }));
    await waitFor(() =>
      expect(fetch.mock.calls.some((_, i) => callInfo(fetch, i).url.includes("/sqs/SetQueueAttributes"))).toBe(true),
    );
    const i = fetch.mock.calls.findIndex((_, n) => callInfo(fetch, n).url.includes("/sqs/SetQueueAttributes"));
    const body = callInfo(fetch, i).body as { QueueUrl: string; Attributes: { Policy: string } };
    expect(body.QueueUrl).toBe("http://e/000000000000/audit-q");
    const statements = (JSON.parse(body.Attributes.Policy) as { Statement: Record<string, unknown>[] }).Statement;
    expect(statements.map((s) => s.Sid)).toEqual(["keep", "events-orders-audit"]);
    expect(statements[1]).toMatchObject({
      Principal: { Service: "events.amazonaws.com" },
      Action: "sqs:SendMessage",
      Resource: QUEUE,
      Condition: { ArnEquals: { "aws:SourceArn": RULE } },
    });
  });

  test("the rule's trigger, state and a link to its queue are shown", async () => {
    routes();
    renderApp(<EventRuleView bus="orders" rule="audit" />);
    expect(await screen.findByText("Audit trail")).toBeInTheDocument();
    expect(screen.getByText("enabled")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Test the pattern" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "audit-q" })).toHaveAttribute("href", "/t/t1/sqs/audit-q");
  });

  test("a schedule rule has no pattern to test", async () => {
    mockFetch([
      [
        "/eventbridge/DescribeRule",
        opOk({ Name: "tick", Arn: RULE, ScheduleExpression: "rate(5 minutes)", State: "DISABLED" }),
      ],
      ["/eventbridge/ListTargetsByRule", opOk({ Targets: [] })],
    ]);
    renderApp(<EventRuleView bus="default" rule="tick" />);
    expect(await screen.findByText("rate(5 minutes)")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Test the pattern" })).toBeNull();
    expect(await screen.findByText("No targets")).toBeInTheDocument();
  });
});
