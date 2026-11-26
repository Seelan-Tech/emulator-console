import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { AssertionAdder } from "./assertion-adder";

test("choosing an assertion asks for its names and adds the step", async () => {
  const onAdd = vi.fn();
  render(<AssertionAdder onAdd={onAdd} />);
  expect(screen.queryByRole("button", { name: /Add to steps/ })).toBeNull();

  await userEvent.selectOptions(screen.getByLabelText("Assertion"), "A queue has N messages");
  await userEvent.type(screen.getByLabelText("Queue URL"), "http://q/orders");
  await userEvent.clear(screen.getByLabelText("How many"));
  await userEvent.type(screen.getByLabelText("How many"), "2");
  await userEvent.click(screen.getByRole("button", { name: /Add to steps/ }));

  expect(onAdd).toHaveBeenCalledOnce();
  expect(onAdd.mock.calls[0]![0]).toMatchObject({
    service: "sqs",
    operation: "GetQueueAttributes",
    input: { QueueUrl: "http://q/orders" },
    expect: [{ path: "Attributes.ApproximateNumberOfMessages", equals: "2" }],
  });
  // ready for the next one
  expect(screen.queryByLabelText("Queue URL")).toBeNull();
});

test("a missing name or a bad count is explained and nothing is added", async () => {
  const onAdd = vi.fn();
  render(<AssertionAdder onAdd={onAdd} />);
  await userEvent.selectOptions(screen.getByLabelText("Assertion"), "A table has N items");
  await userEvent.click(screen.getByRole("button", { name: /Add to steps/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("Table name is required");
  await userEvent.type(screen.getByLabelText("Table name"), "orders");
  await userEvent.clear(screen.getByLabelText("How many"));
  await userEvent.type(screen.getByLabelText("How many"), "x");
  await userEvent.click(screen.getByRole("button", { name: /Add to steps/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("whole number");
  expect(onAdd).not.toHaveBeenCalled();
});
