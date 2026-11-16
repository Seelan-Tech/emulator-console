import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { emptySpec, type QuerySpec, type TableShape } from "./query";
import { QueryBuilder } from "./query-builder";

const shape: TableShape = {
  KeySchema: [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "pk", AttributeType: "S" },
    { AttributeName: "sk", AttributeType: "N" },
    { AttributeName: "gpk", AttributeType: "S" },
  ],
  GlobalSecondaryIndexes: [{ IndexName: "by-g", KeySchema: [{ AttributeName: "gpk", KeyType: "HASH" }] }],
};

function Harness({ onRun = vi.fn(), initial = emptySpec() }: { onRun?: () => void; initial?: QuerySpec }) {
  const [spec, setSpec] = useState(initial);
  return (
    <QueryBuilder
      shape={shape}
      table="orders"
      value={spec}
      onChange={setSpec}
      onRun={onRun}
      knownAttributes={["status"]}
    />
  );
}

describe("QueryBuilder", () => {
  test("scan mode shows no key condition and runs straight away", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    expect(screen.queryByLabelText("Partition key value")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Run/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  test("query mode asks for the partition key and blocks an incomplete request", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    await user.selectOptions(screen.getByLabelText("Mode"), "query");
    expect(screen.getByLabelText("Partition key value")).toHaveAttribute("placeholder", "pk (string) =");
    expect(screen.getByLabelText("Sort key value")).toHaveAttribute("placeholder", "sk (number, optional)");
    await user.click(screen.getByRole("button", { name: /Run/ }));
    expect(onRun).not.toHaveBeenCalled();
  });

  test("a complete query runs", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    await user.selectOptions(screen.getByLabelText("Mode"), "query");
    await user.type(screen.getByLabelText("Partition key value"), "u1");
    await user.click(screen.getByRole("button", { name: /Run/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  test("'between' reveals an upper bound", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Mode"), "query");
    expect(screen.queryByLabelText("Sort key upper bound")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Sort key operator"), "between");
    expect(screen.getByLabelText("Sort key upper bound")).toBeInTheDocument();
  });

  test("filters can be added, edited and removed; two filters show the AND/OR choice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Add filter/ }));
    await user.type(screen.getByLabelText("Filter 1 attribute"), "status");
    expect(screen.getByLabelText("Filter 1 attribute")).toHaveValue("status");
    expect(screen.queryByLabelText("Combine filters")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add filter/ }));
    expect(screen.getByLabelText("Combine filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove filter 2" }));
    expect(screen.queryByLabelText("Filter 2 attribute")).not.toBeInTheDocument();
  });

  test("an 'exists' filter takes no value", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Add filter/ }));
    await user.selectOptions(screen.getByLabelText("Filter 1 operator"), "exists");
    expect(screen.queryByLabelText("Filter 1 value")).not.toBeInTheDocument();
  });

  test("a global secondary index cannot be read consistently", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByLabelText("Consistent read")).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Index"), "by-g");
    expect(screen.getByLabelText("Consistent read")).toBeDisabled();
  });

  test("the request preview and the AWS CLI command follow the form", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Mode"), "query");
    await user.type(screen.getByLabelText("Partition key value"), "u1");
    await user.click(screen.getByRole("button", { name: /Show request/ }));
    expect(screen.getByTestId("request-preview")).toHaveTextContent("KeyConditionExpression");
    expect(screen.getByTestId("cli")).toHaveTextContent("aws dynamodb query");
    await user.click(screen.getByRole("button", { name: /Hide request/ }));
    expect(screen.queryByTestId("request-preview")).not.toBeInTheDocument();
  });

  test("reset returns to a plain scan", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Mode"), "query");
    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect(screen.getByLabelText("Mode")).toHaveValue("scan");
  });
});
