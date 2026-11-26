import { expect, test, uniq } from "./fixtures";

test("a fixture step keeps a value from its response and a later step uses it", async ({ page, target, call }) => {
  const queue = uniq("e2e-fv");
  const fixture = await (
    await page.request.post("/api/fixtures", {
      data: {
        name: uniq("e2e-vars"),
        steps: [
          { service: "sqs", operation: "CreateQueue", input: { QueueName: queue }, capture: { url: "QueueUrl" } },
          {
            service: "sqs",
            operation: "SendMessage",
            input: { QueueUrl: "{{url}}", MessageBody: "hello from {{url}}" },
          },
        ],
      },
    })
  ).json();
  const run = () =>
    page.request.post(`/api/fixtures/${fixture.id}/run`, { data: { targetId: target.tid } }).then((r) => r.json());

  try {
    const done = await run();
    expect(done.status).toBe("succeeded");
    expect(done.results[0].captured).toEqual(["url"]);
    expect(JSON.stringify(done.results)).not.toContain(queue); // names are kept, never the values

    const { QueueUrl } = await call("sqs", "GetQueueUrl", { QueueName: queue });
    const got = await call("sqs", "ReceiveMessage", { QueueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 });
    expect(got.Messages[0].Body).toBe(`hello from ${QueueUrl}`);

    // a step that uses a name no step has set fails before anything is sent
    const bad = await (
      await page.request.put(`/api/fixtures/${fixture.id}`, {
        data: {
          steps: [{ service: "sqs", operation: "SendMessage", input: { QueueUrl: "{{nope}}", MessageBody: "x" } }],
        },
      })
    ).json();
    expect(bad.error).toBeUndefined();
    const failed = await run();
    expect(failed.status).toBe("failed");
    expect(failed.results[0].error).toMatch(/Variable "nope" is not set/);
  } finally {
    const q = await call("sqs", "GetQueueUrl", { QueueName: queue }).catch(() => null);
    if (q) await call("sqs", "DeleteQueue", { QueueUrl: q.QueueUrl }).catch(() => {});
    await page.request.delete(`/api/fixtures/${fixture.id}`);
  }
});

test("Check reads a fixture without calling the emulator, and a failed run resumes from the failed step", async ({
  page,
  call,
}) => {
  const bucket = uniq("e2e-fr");
  const other = uniq("e2e-fo");
  const queue = uniq("e2e-fq");
  const name = uniq("e2e-resume");
  const fixture = await (
    await page.request.post("/api/fixtures", {
      data: {
        name,
        steps: [
          { service: "s3", operation: "CreateBucket", input: { Bucket: bucket } },
          { service: "sqs", operation: "CreateQueue", input: { QueueName: queue }, capture: { url: "QueueUrl" } },
          { service: "s3", operation: "HeadBucket", input: { Bucket: other } },
          { service: "sqs", operation: "SendMessage", input: { QueueUrl: "{{url}}", MessageBody: "resumed" } },
        ],
      },
    })
  ).json();

  try {
    // the API check finds a typo'd field, a missing one and a variable nothing captures
    const bad = await (
      await page.request.post("/api/fixtures/check", {
        data: {
          steps: [
            { service: "s3", operation: "CreateBucket", input: {} },
            { service: "sqs", operation: "DeleteQueue", input: { QueueUrl: "{{nope}}", Quue: 1 } },
          ],
        },
      })
    ).json();
    expect(bad.problems.map((p: any) => `${p.step} ${p.level} ${p.message}`)).toEqual([
      "0 error Bucket is required",
      "1 error uses {{nope}}, which no step captures",
      "1 warning Quue is not a field of this operation (it is ignored)",
    ]);

    await page.goto(`/fixtures/${fixture.id}`);
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByTestId("check-result")).toContainText("No problems found");

    // step 3 fails: the bucket it reads does not exist yet
    await page.getByRole("button", { name: /Save & run/ }).click();
    await expect(page.getByText("Run failed")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("button", { name: "Resume from step 3" })).toBeVisible();

    // fix the cause, then resume: step 1 is not run again, step 2 is (step 4 needs its value)
    await call("s3", "CreateBucket", { Bucket: other });
    await page.getByRole("button", { name: "Resume from step 3" }).click();
    await expect(page.getByText("Run succeeded")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("fixture-results").getByRole("row")).toHaveCount(4); // header + steps 2, 3, 4
    await expect(page.getByTestId("fixture-results")).toContainText("kept url");

    const { QueueUrl } = await call("sqs", "GetQueueUrl", { QueueName: queue });
    const got = await call("sqs", "ReceiveMessage", { QueueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 });
    expect(got.Messages[0].Body).toBe("resumed");
  } finally {
    for (const b of [bucket, other]) await call("s3", "DeleteBucket", { Bucket: b }).catch(() => {});
    const q = await call("sqs", "GetQueueUrl", { QueueName: queue }).catch(() => null);
    if (q) await call("sqs", "DeleteQueue", { QueueUrl: q.QueueUrl }).catch(() => {});
    await page.request.delete(`/api/fixtures/${fixture.id}`);
  }
});
