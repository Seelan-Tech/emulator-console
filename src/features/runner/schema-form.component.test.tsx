import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import type { Field } from "@/lib/schema";

import { SchemaForm } from "./schema-form";

// The CodeMirror editor is not needed for these tests, and jsdom cannot lay it out.
vi.mock("@/components/code-editor", () => ({ CodeEditor: () => <div data-testid="code-editor" /> }));

const field: Field = {
  kind: "struct",
  fields: [
    { name: "QueueName", required: true, field: { kind: "string" } },
    { name: "Delay", required: false, field: { kind: "number" } },
    { name: "Fifo", required: false, field: { kind: "boolean" } },
    { name: "Tags", required: false, field: { kind: "map", value: { kind: "string" } } },
    { name: "Names", required: false, field: { kind: "list", item: { kind: "string" } } },
  ],
};

function Harness({ initial = {}, onValue }: { initial?: unknown; onValue: (v: unknown) => void }) {
  const [v, setV] = useState<unknown>(initial);
  return (
    <SchemaForm
      field={field}
      value={v}
      onChange={(x) => {
        setV(x);
        onValue(x);
      }}
    />
  );
}
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as unknown;

describe("SchemaForm", () => {
  test("typed values are reported with unset members left out", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(screen.getByLabelText("QueueName"), "jobs");
    expect(last(onValue)).toEqual({ QueueName: "jobs" });
    await user.type(screen.getByLabelText("Delay"), "5");
    expect(last(onValue)).toEqual({ QueueName: "jobs", Delay: 5 });
  });

  test("clearing a field removes it from the request", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(screen.getByLabelText("QueueName"), "a");
    await user.clear(screen.getByLabelText("QueueName"));
    expect(last(onValue)).toEqual({});
  });

  test("booleans are tri-state: unset, true, false", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.selectOptions(screen.getByLabelText("Fifo"), "false");
    expect(last(onValue)).toEqual({ Fifo: false });
    await user.selectOptions(screen.getByLabelText("Fifo"), "");
    expect(last(onValue)).toEqual({});
  });

  test("map entries can be added, keyed, valued and removed", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(screen.getAllByRole("button", { name: /Add/ })[0]!);
    await user.type(screen.getByLabelText("Key 1"), "env");
    await user.type(screen.getByLabelText("Tags 1"), "dev");
    expect(last(onValue)).toEqual({ Tags: { env: "dev" } });
    await user.click(screen.getByRole("button", { name: "Remove entry 1" }));
    expect(last(onValue)).toEqual({});
  });

  test("list items can be added and removed", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Names 1"), "x");
    expect(last(onValue)).toEqual({ Names: ["x"] });
    await user.click(screen.getByRole("button", { name: "Remove item 1" }));
    expect(last(onValue)).toEqual({});
  });

  test("a half-filled map row stays in the form until it has a value", async () => {
    const user = userEvent.setup();
    render(<Harness onValue={vi.fn()} />);
    await user.click(screen.getAllByRole("button", { name: /Add/ })[0]!);
    expect(screen.getByLabelText("Key 1")).toBeInTheDocument();
  });

  test("starts from an initial value", () => {
    render(<Harness initial={{ QueueName: "seeded", Delay: 3 }} onValue={vi.fn()} />);
    expect(screen.getByLabelText("QueueName")).toHaveValue("seeded");
    expect(screen.getByLabelText("Delay")).toHaveValue(3);
  });

  test("a value changed from outside (the JSON tab) replaces the draft", () => {
    const { rerender } = render(<SchemaForm field={field} value={{ QueueName: "one" }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("QueueName")).toHaveValue("one");
    rerender(<SchemaForm field={field} value={{ QueueName: "two" }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("QueueName")).toHaveValue("two");
  });
});
