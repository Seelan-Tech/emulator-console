import { expect, expectToast, test, uniq } from "./fixtures";

test("record in the UI, save as a fixture, wipe, replay, state is back (incl. a Lambda zip)", async ({
  page,
  target,
  call,
}) => {
  const bucket = uniq("e2e-rb");
  const queue = uniq("e2e-rq");
  const fn = uniq("e2e-rf");
  const fixtureName = uniq("e2e-fixture");
  // Simulates a restart for the S3 bucket and the Lambda. The queue is left in place on purpose: SQS (like AWS)
  // refuses to recreate a queue name within 60 s of deleting it, which a real restart never triggers, and
  // replaying CreateQueue onto an existing identical queue must simply succeed.
  const wipe = async () => {
    await call("s3", "DeleteBucket", { Bucket: bucket }).catch(() => {});
    await call("lambda", "DeleteFunction", { FunctionName: fn }).catch(() => {});
  };
  const removeQueue = async () => {
    const q = await call("sqs", "GetQueueUrl", { QueueName: queue }).catch(() => null);
    if (q) await call("sqs", "DeleteQueue", { QueueUrl: q.QueueUrl }).catch(() => {});
  };

  try {
    // 1. do things in the native screens; every state-changing call is recorded
    await page.goto(`${target.base}/s3`);
    await page.getByRole("button", { name: "Create bucket" }).first().click();
    await page.getByLabel("Bucket name").fill(bucket);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: bucket })).toBeVisible();

    await page.goto(`${target.base}/sqs`);
    await page.getByRole("button", { name: "Create queue" }).first().click();
    await page.getByLabel("Queue name").fill(queue);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: queue })).toBeVisible();

    await page.goto(`${target.base}/lambda`);
    await page.getByRole("button", { name: "Create function" }).first().click();
    await page.getByLabel("Function name").fill(fn);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("row", { name: new RegExp(fn) }).getByText("Active")).toBeVisible({ timeout: 30_000 });

    // reads are not recorded, and the steps survive a reload
    await page.goto(`${target.base}/s3`);
    await expect(page.getByTestId("recorder-count")).toHaveText("3 steps");
    await page.reload();
    await expect(page.getByTestId("recorder-count")).toHaveText("3 steps");

    // pausing the recorder stops capturing
    await page.getByLabel("Record state-changing calls").click();
    await call("s3", "CreateBucket", { Bucket: `${bucket}-x` }); // not via the UI: never recorded anyway
    await page.getByLabel("Record state-changing calls").click();

    // 2. save as a fixture from the drawer
    await page.getByRole("button", { name: "Save as fixture" }).click();
    await page.getByPlaceholder("Fixture name").fill(fixtureName);
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expectToast(page, /Saved fixture/);
    await expect(page.getByTestId("recorder-count")).toHaveText("0 steps");

    // 3. wipe the emulator state, as a restart would
    await wipe();
    await call("s3", "DeleteBucket", { Bucket: `${bucket}-x` }).catch(() => {});
    await expect(call("s3", "HeadBucket", { Bucket: bucket })).rejects.toThrow();

    // 4. replay from the fixtures page
    await page.goto(`${target.base.replace(/\/t\/.*/, "")}/fixtures`);
    await page.getByRole("link", { name: fixtureName }).click();
    await page.getByRole("button", { name: /Save & run/ }).click();
    await expect(page.getByText(/^Run (succeeded|failed)$/)).toBeVisible({ timeout: 40_000 });
    if (await page.getByText("Run failed").count())
      throw new Error(`replay failed:\n${await page.getByRole("table").first().innerText()}`);
    await expect(page.getByText("Run succeeded")).toBeVisible();

    // 5. everything is back, including the Lambda that was rebuilt from a recorded zip
    await call("s3", "HeadBucket", { Bucket: bucket });
    await call("sqs", "GetQueueUrl", { QueueName: queue });
    await expect
      .poll(async () => (await call("lambda", "GetFunctionConfiguration", { FunctionName: fn })).State, {
        timeout: 20_000,
      })
      .toBe("Active");
    const out = await call("lambda", "Invoke", { FunctionName: fn, Payload: '{"again":1}' });
    expect(JSON.parse(out.Payload)).toEqual({ echo: { again: 1 } });

    // the replay is in the audit log, attributed to the fixture
    await page.goto(`${target.base.replace(/\/t\/.*/, "")}/activity`);
    await expect(page.getByText("fixture", { exact: true }).first()).toBeVisible();
  } finally {
    await wipe();
    await removeQueue();
    await call("s3", "DeleteBucket", { Bucket: `${bucket}-x` }).catch(() => {});
    const res = await page.request.get("/api/fixtures");
    for (const f of (await res.json()).filter((f: any) => f.name === fixtureName))
      await page.request.delete(`/api/fixtures/${f.id}`);
  }
});
