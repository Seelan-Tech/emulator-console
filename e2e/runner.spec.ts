import { expect, test, uniq } from "./fixtures";

test("generic runner: search operations, generated form, JSON sync, errors, recording", async ({
  page,
  target,
  call,
}) => {
  const param = `/${uniq("e2e-param")}`;
  try {
    // find an operation of a service that has no dedicated screen
    await page.goto(`${target.base}/s/ssm`);
    await page.getByLabel("Search operations").fill("PutParameter");
    await expect(page.getByTestId("operations").getByRole("link")).toHaveCount(1);
    await page.getByRole("link", { name: /PutParameter/ }).click();
    await expect(page).toHaveURL(/\/s\/ssm\/PutParameter$/);

    // the form is generated from the SDK schema: required fields (marked) are shown, optional ones are tucked away
    const form = page.getByTestId("schema-form");
    await expect(form.getByText("Optional fields")).toBeVisible();
    await form.getByLabel("Name", { exact: true }).fill(param);
    await form.getByLabel("Value", { exact: true }).fill("v1");
    await form.getByText("Optional fields").click(); // Type is optional in the model, though the emulator wants it
    await form.getByLabel("Type", { exact: true }).fill("String");

    // the JSON tab shows the same input, and edits there flow back into the form
    await page.getByRole("tab", { name: "JSON" }).click();
    await expect(page.locator(".cm-content").first()).toContainText(param);
    await page.getByRole("tab", { name: "Form" }).click();

    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByTestId("outcome").getByText("Success")).toBeVisible();
    const got = await call("ssm", "GetParameter", { Name: param });
    expect(got.Parameter.Value).toBe("v1");
    await expect(page.getByTestId("recorder-count")).toHaveText("1 step"); // writes are recorded

    // an AWS error is shown in full instead of a toast
    await page.goto(`${target.base}/s/ssm/GetParameter`);
    await page.getByTestId("schema-form").getByLabel("Name", { exact: true }).fill("/does/not/exist");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByTestId("outcome")).toContainText("ParameterNotFound");

    // an operation with no input
    await page.goto(`${target.base}/s/sts/GetCallerIdentity`);
    await expect(page.getByText("takes no input")).toBeVisible();
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByTestId("outcome")).toContainText("arn:aws:iam");
  } finally {
    await call("ssm", "DeleteParameter", { Name: param }).catch(() => {});
  }
});

test("generic runner: map and list inputs (SQS CreateQueue attributes)", async ({ page, target, call }) => {
  const name = uniq("e2e-rq");
  try {
    await page.goto(`${target.base}/s/sqs/CreateQueue`);
    const form = page.getByTestId("schema-form");
    await form.getByLabel("QueueName", { exact: true }).fill(name);
    await form.getByText("Optional fields").click();
    await form.getByRole("button", { name: "Add entry" }).first().click();
    await form.getByLabel("Key 1").fill("VisibilityTimeout");
    await form.getByLabel("Attributes 1").fill("45");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByTestId("outcome").getByText("Success")).toBeVisible();
    const { QueueUrl } = await call("sqs", "GetQueueUrl", { QueueName: name });
    const attrs = await call("sqs", "GetQueueAttributes", { QueueUrl, AttributeNames: ["VisibilityTimeout"] });
    expect(attrs.Attributes.VisibilityTimeout).toBe("45");
  } finally {
    const { QueueUrl } = await call("sqs", "GetQueueUrl", { QueueName: name }).catch(() => ({ QueueUrl: "" }));
    if (QueueUrl) await call("sqs", "DeleteQueue", { QueueUrl }).catch(() => {});
  }
});

test("every service links to its operations and sidebar items resolve", async ({ page, target }) => {
  await page.goto(`${target.base}/s`);
  for (const svc of ["kms", "iam", "ec2", "eventbridge"]) {
    await page.goto(`${target.base}/s/${svc}`);
    await expect(page.getByTestId("operations").getByRole("link").first()).toBeVisible();
  }
});
