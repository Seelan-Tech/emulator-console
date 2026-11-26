import { expect, test, uniq } from "./fixtures";

test("a fixture asserts on what it built: a check that holds passes, one that does not fails and is counted", async ({
  page,
  call,
}) => {
  const queue = uniq("e2e-fa");
  const fixture = await (
    await page.request.post("/api/fixtures", {
      data: {
        name: uniq("e2e-assert"),
        steps: [
          { service: "sqs", operation: "CreateQueue", input: { QueueName: queue }, capture: { url: "QueueUrl" } },
          {
            service: "sqs",
            operation: "GetQueueAttributes",
            input: { QueueUrl: "{{url}}", AttributeNames: ["ApproximateNumberOfMessages"] },
            expect: [{ path: "Attributes.ApproximateNumberOfMessages", equals: "0" }],
          },
          { service: "sqs", operation: "SendMessage", input: { QueueUrl: "{{url}}", MessageBody: "one" } },
          {
            service: "sqs",
            operation: "GetQueueAttributes",
            input: { QueueUrl: "{{url}}", AttributeNames: ["ApproximateNumberOfMessages"] },
            retries: 5,
            retryDelayMs: 500,
            expect: [{ path: "Attributes.ApproximateNumberOfMessages", gte: 1 }],
          },
          {
            service: "sqs",
            operation: "GetQueueAttributes",
            input: { QueueUrl: "{{url}}", AttributeNames: ["ApproximateNumberOfMessages"] },
            expect: [{ path: "Attributes.ApproximateNumberOfMessages", equals: "0" }],
          },
        ],
      },
    })
  ).json();

  try {
    await page.goto(`/fixtures/${fixture.id}`);
    await page.getByRole("button", { name: /Save & run/ }).click();
    await expect(page.getByText("Run failed", { exact: true })).toBeVisible({ timeout: 40_000 });
    // two of the three assertions held; the last one saw the message sent in step 3
    await expect(page.getByText("2 of 3 assertions held").first()).toBeVisible();
    const results = page.getByTestId("fixture-results");
    await expect(results).toContainText("1 check holds");
    await expect(results).toContainText('Attributes.ApproximateNumberOfMessages: expected "0", got "1"');
    // the history says the same
    await expect(page.getByText("· 2 of 3 assertions held")).toBeVisible();
  } finally {
    const q = await call("sqs", "GetQueueUrl", { QueueName: queue }).catch(() => null);
    if (q) await call("sqs", "DeleteQueue", { QueueUrl: q.QueueUrl }).catch(() => {});
    await page.request.delete(`/api/fixtures/${fixture.id}`);
  }
});

test("an assertion is added to a fixture from a template and saved", async ({ page }) => {
  const fixture = await (
    await page.request.post("/api/fixtures", { data: { name: uniq("e2e-adder"), steps: [] } })
  ).json();
  try {
    await page.goto(`/fixtures/${fixture.id}`);
    await page.getByLabel("Assertion").selectOption({ label: "A Lambda function is Active" });
    await page.getByLabel("Function name").fill("e2e-not-created");
    await page.getByRole("button", { name: "Add to steps" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get(`/api/fixtures/${fixture.id}`)).json()).steps)
      .toMatchObject([
        {
          service: "lambda",
          operation: "GetFunction",
          input: { FunctionName: "e2e-not-created" },
          expect: [{ path: "Configuration.State", equals: "Active" }],
          retries: 10,
        },
      ]);
    // Check reads the new step without calling the emulator and finds nothing wrong
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByTestId("check-result")).toContainText("No problems found");
  } finally {
    await page.request.delete(`/api/fixtures/${fixture.id}`);
  }
});
