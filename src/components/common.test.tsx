import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { ConfirmDialog, CopyButton, EmptyState, JsonViewer } from "./common";

describe("ConfirmDialog", () => {
  const open = (props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete it?"
        description="Gone for good"
        onConfirm={onConfirm}
        {...props}
      />,
    );
    return { onConfirm, onOpenChange };
  };

  test("a plain confirmation runs the action and closes", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = open();
    expect(screen.getByText("Gone for good")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  test("a destructive action can require typing the resource name", async () => {
    const user = userEvent.setup();
    const { onConfirm } = open({ typeToConfirm: "my-bucket" });
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmation"), "my-bucke");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmation"), "t");
    expect(button).toBeEnabled();
    await user.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });

  test("cancel closes without running the action", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("a custom confirm label is used", () => {
    open({ confirmLabel: "Purge" });
    expect(screen.getByRole("button", { name: "Purge" })).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  test("copies the value to the clipboard and confirms briefly", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="arn:aws:s3:::b" label="Copy ARN" />);
    await user.click(screen.getByRole("button", { name: "Copy ARN" }));
    expect(await navigator.clipboard.readText()).toBe("arn:aws:s3:::b");
  });

  test("does not blow up when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="x" />);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});

test("EmptyState shows its title, description and action", () => {
  render(<EmptyState title="No buckets" description="Create one" action={<button>Create</button>} />);
  expect(screen.getByText("No buckets")).toBeInTheDocument();
  expect(screen.getByText("Create one")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
});

test("JsonViewer pretty-prints objects and shows strings as they are", () => {
  const { rerender } = render(<JsonViewer value={{ a: 1 }} />);
  expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  rerender(<JsonViewer value="already text" />);
  expect(screen.getByText("already text")).toBeInTheDocument();
});
