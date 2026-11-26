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
