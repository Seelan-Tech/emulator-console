import type { Page } from "@playwright/test";

import { makeZip } from "../src/features/lambda/zip";
import { expect, expectToast, test, uniq } from "./fixtures";

const setEditor = async (page: Page, nth: number, text: string) => {
  const ed = page.locator(".cm-content").nth(nth);
  await ed.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
};

test("Lambda: create, invoke with logs, update code, handled error, saved events, delete", async ({
  page,
  target,
  call,
}) => {
  const name = uniq("e2e-fn");
  await page.goto(`${target.base}/lambda`);

  await page.getByRole("button", { name: "Create function" }).first().click();
  await page.getByLabel("Function name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("Active")).toBeVisible({ timeout: 30_000 }); // polls out of Pending

  try {
    await page.getByRole("link", { name }).click();
    await expect(page.getByTestId("fn-state")).toHaveText("Active", { timeout: 45_000 });

    // invoke the starter template
    await setEditor(page, 0, '{"who":"e2e"}');
    await page.getByRole("button", { name: "Invoke" }).click();
    await expect(page.getByTestId("invoke-result").getByText("HTTP 200")).toBeVisible();
    await expect(page.getByTestId("invoke-result")).toContainText('"who": "e2e"');
    await expect(page.getByTestId("invoke-log")).toContainText("event:");

    // update the code through the UI, then invoke again
    await page.getByRole("tab", { name: "Code" }).click();
    await setEditor(page, 0, "def handler(event, context):\n    print('v2')\n    return {'version': 2}\n");
    await page.getByRole("button", { name: "Update code" }).click();
    await expectToast(page, "Code updated");
    await page.getByRole("tab", { name: "Invoke" }).click();
    await expect(page.getByTestId("fn-state")).toHaveText("Active", { timeout: 45_000 });
    await page.getByRole("button", { name: "Invoke" }).click();
    await expect(page.getByTestId("invoke-result")).toContainText('"version": 2');
    await expect(page.getByTestId("invoke-log")).toContainText("v2");

    // a function that raises: HTTP 200 with a FunctionError badge and the traceback in the response
    await page.getByRole("tab", { name: "Code" }).click();
    await setEditor(page, 0, "def handler(event, context):\n    raise ValueError('boom')\n");
    await page.getByRole("button", { name: "Update code" }).click();
    await expectToast(page, "Code updated");
    await page.getByRole("tab", { name: "Invoke" }).click();
    await expect(page.getByTestId("fn-state")).toHaveText("Active", { timeout: 45_000 });
    await page.getByRole("button", { name: "Invoke" }).click();
    await expect(page.getByTestId("invoke-result").getByText("Unhandled")).toBeVisible();
    await expect(page.getByTestId("invoke-result")).toContainText("boom");

    // saved test events survive a reload
    page.once("dialog", (d) => d.accept("my event"));
    await page.getByRole("button", { name: "Save event" }).click();
    await page.reload();
    await expect(page.getByLabel("Saved events").locator("option", { hasText: "my event" })).toHaveCount(1);
  } finally {
    await call("lambda", "DeleteFunction", { FunctionName: name }).catch(() => {});
  }
});

test("Lambda: Node.js runtime and zip upload", async ({ page, target, call }) => {
  const nodeFn = uniq("e2e-node");
  const zipFn = uniq("e2e-zip");
  await page.goto(`${target.base}/lambda`);

  // Node runtime: the starter code switches with the runtime
  await page.getByRole("button", { name: "Create function" }).first().click();
  await page.getByLabel("Function name").fill(nodeFn);
  await page.getByLabel("Runtime").selectOption("nodejs20.x");
  await expect(page.locator(".cm-content").first()).toContainText("export const handler");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

  // zip upload (built with the same code the UI uses)
  await page.getByRole("button", { name: "Create function" }).first().click();
  await page.getByLabel("Function name").fill(zipFn);
  await page.getByTestId("zip-input").setInputFiles({
    name: "code.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(makeZip("index.py", "def handler(e, c):\n    return {'from': 'zip'}\n")),
  });
  await expect(page.getByText("code.zip")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

  try {
    await expect(page.getByRole("row", { name: new RegExp(nodeFn) }).getByText("Active")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("row", { name: new RegExp(zipFn) }).getByText("Active")).toBeVisible({
      timeout: 30_000,
    });
    const n = await call("lambda", "Invoke", { FunctionName: nodeFn, Payload: '{"a":1}' });
    expect(JSON.parse(n.Payload)).toEqual({ echo: { a: 1 } });
    const z = await call("lambda", "Invoke", { FunctionName: zipFn, Payload: "{}" });
    expect(JSON.parse(z.Payload)).toEqual({ from: "zip" });
  } finally {
    await call("lambda", "DeleteFunction", { FunctionName: nodeFn }).catch(() => {});
    await call("lambda", "DeleteFunction", { FunctionName: zipFn }).catch(() => {});
  }
});

test("Lambda: the Logs tab shows runs started from the console and by an SNS subscription", async ({
  page,
  target,
  call,
}) => {
  const fn = uniq("e2e-logs");
  const topic = uniq("e2e-logs-topic");
  const marker = uniq("marker");
  const source = `def handler(event, context):\n    print("${marker}")\n    print('{"compact":{"a":1,"b":[2]}}')\n    print({"pyrepr": {"n": None, "ok": True}})\n    if event.get("fail"):\n        raise ValueError("planned failure")\n    return {"ok": True}\n`;
  let topicArn: string | undefined;
  try {
    await call("lambda", "CreateFunction", {
      FunctionName: fn,
      Runtime: "python3.12",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Handler: "index.handler",
      Code: { ZipFile: { $base64: Buffer.from(makeZip("index.py", source)).toString("base64") } },
    });
    for (let i = 0; i < 60; i++) {
      const c = await call("lambda", "GetFunctionConfiguration", { FunctionName: fn });
      if (c.State === "Active" && c.LastUpdateStatus !== "InProgress") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const fnArn = (await call("lambda", "GetFunctionConfiguration", { FunctionName: fn })).FunctionArn as string;

    // a run started outside the Invoke tab that fails, then one started by SNS
    await call("lambda", "Invoke", { FunctionName: fn, Payload: '{"fail":true}' });
    topicArn = (await call("sns", "CreateTopic", { Name: topic })).TopicArn as string;
    await call("lambda", "AddPermission", {
      FunctionName: fn,
      StatementId: "sns",
      Action: "lambda:InvokeFunction",
      Principal: "sns.amazonaws.com",
      SourceArn: topicArn,
    });
    await call("sns", "Subscribe", { TopicArn: topicArn, Protocol: "lambda", Endpoint: fnArn });
    await call("sns", "Publish", { TopicArn: topicArn, Message: "hello" });

    await page.goto(`${target.base}/lambda/${fn}`);
    await page.getByRole("tab", { name: "Logs" }).click();
    const runs = page.getByTestId("lambda-run");
    // logs can lag the runs by a few seconds
    await expect(async () => {
      await page.getByRole("button", { name: "Refresh logs" }).click();
      await expect(runs).toHaveCount(2, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(runs.filter({ hasText: "ValueError: planned failure" })).toHaveCount(1);
    await expect(runs.filter({ hasText: "ValueError: planned failure" })).toContainText("error");
    await runs.first().locator("summary").click();
    await expect(page.getByTestId("lambda-logs")).toContainText(marker);
    // printed JSON is spread over lines, until the switch is turned off
    await expect(runs.first().locator("pre")).toContainText('"compact": {');
    await expect(runs.first().locator("pre")).toContainText('"pyrepr": {');
    await expect(runs.first().locator("pre")).toContainText('"n": null');
    await page.getByLabel("Format JSON in logs").click();
    await expect(runs.first().locator("pre")).toContainText('{"compact":{"a":1,"b":[2]}}');
  } finally {
    if (topicArn) await call("sns", "DeleteTopic", { TopicArn: topicArn }).catch(() => {});
    await call("lambda", "DeleteFunction", { FunctionName: fn }).catch(() => {});
    await call("logs", "DeleteLogGroup", { logGroupName: `/aws/lambda/${fn}` }).catch(() => {});
  }
});
