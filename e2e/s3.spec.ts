import { expect, expectToast, test, uniq } from "./fixtures";

test("S3: create bucket, upload, preview, folders, bulk delete, typed-confirm bucket delete", async ({
  page,
  target,
  call,
}) => {
  const bucket = uniq("e2e-s3");
  try {
    await page.goto(`${target.base}/s3`);

    // create bucket (with live name validation)
    await page.getByRole("button", { name: "Create bucket" }).first().click();
    await page.getByLabel("Bucket name").fill("Bad_Name");
    await expect(page.getByText(/Lowercase letters/)).toBeVisible();
    await page.getByLabel("Bucket name").fill(bucket);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: bucket })).toBeVisible();
    await expect(page.getByTestId("recorder-count")).toHaveText("1 step");

    // open it; URL-driven
    await page.getByRole("link", { name: bucket }).click();
    await expect(page).toHaveURL(new RegExp(`/s3/${bucket}$`));
    await expect(page.getByText("This folder is empty")).toBeVisible();

    // upload a text file and a binary file
    await page.getByTestId("file-input").setInputFiles([
      { name: "hello.txt", mimeType: "text/plain", buffer: Buffer.from("hello from playwright") },
      { name: "data.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0, 255, 1, 254, 2, 253]) },
    ]);
    await expect(page.getByRole("cell", { name: "hello.txt", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "data.bin", exact: true })).toBeVisible();

    // preview + download round trip
    await page.getByRole("button", { name: "Preview hello.txt" }).click();
    await expect(page.getByTestId("preview-text")).toHaveText("hello from playwright");
    await page.keyboard.press("Escape");
    const dl = await page.request.get(`/api/targets/${target.tid}/s3/_download?bucket=${bucket}&key=data.bin`);
    expect([...(await dl.body())]).toEqual([0, 255, 1, 254, 2, 253]);

    // folder: create, enter, upload inside, breadcrumb back
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("docs");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: "docs" }).click();
    await expect(page).toHaveURL(/prefix=docs%2F/);
    await page
      .getByTestId("file-input")
      .setInputFiles({ name: "inner.md", mimeType: "text/markdown", buffer: Buffer.from("# inner") });
    await expect(page.getByRole("cell", { name: "inner.md", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Path" }).getByRole("link", { name: bucket }).click();
    await expect(page.getByRole("cell", { name: "hello.txt", exact: true })).toBeVisible();

    // filter and sort
    await page.getByLabel("Filter").fill("hello");
    await expect(page.getByRole("cell", { name: "data.bin", exact: true })).toHaveCount(0);
    await page.getByLabel("Filter").fill("");

    // bulk delete the two files
    await page.getByLabel("Select hello.txt").click();
    await page.getByLabel("Select data.bin").click();
    await page.getByRole("button", { name: "Delete 2 selected" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expectToast(page, "Deleted 2 objects");
    await expect(page.getByRole("cell", { name: "hello.txt", exact: true })).toHaveCount(0);

    // delete the folder with its contents
    await page.getByRole("button", { name: "Delete folder docs" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("This folder is empty")).toBeVisible();
    const left = await call("s3", "ListObjectsV2", { Bucket: bucket });
    expect(left.KeyCount).toBe(0);

    // typed-confirm bucket delete
    await page.goto(`${target.base}/s3`);
    await page.getByRole("button", { name: `Delete bucket ${bucket}` }).click();
    const confirmBtn = page.getByRole("dialog").getByRole("button", { name: "Delete" });
    await expect(confirmBtn).toBeDisabled();
    await page.getByLabel("Confirmation").fill(bucket);
    await confirmBtn.click();
    await expect(page.getByRole("link", { name: bucket })).toHaveCount(0);
  } finally {
    // normally the test deletes the bucket itself; this only matters when it failed part-way
    await call("s3", "DeleteObjects", {
      Bucket: bucket,
      Delete: { Objects: [{ Key: "hello.txt" }, { Key: "data.bin" }] },
    }).catch(() => {});
    await call("s3", "DeleteBucket", { Bucket: bucket }).catch(() => {});
  }
});

test("S3: a file above 8 MB uploads (multipart) and downloads byte-identical", async ({ page, target, call }) => {
  const bucket = uniq("e2e-big");
  await call("s3", "CreateBucket", { Bucket: bucket });
  try {
    await page.goto(`${target.base}/s3/${bucket}`);
    const big = Buffer.alloc(9 * 1024 * 1024 + 123, 7);
    await page
      .getByTestId("file-input")
      .setInputFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
    await expect(page.getByRole("cell", { name: "big.bin", exact: true })).toBeVisible({ timeout: 30_000 });
    const dl = await page.request.get(`/api/targets/${target.tid}/s3/_download?bucket=${bucket}&key=big.bin`);
    expect((await dl.body()).equals(big)).toBe(true);
  } finally {
    await call("s3", "DeleteObjects", { Bucket: bucket, Delete: { Objects: [{ Key: "big.bin" }] } }).catch(() => {});
    await call("s3", "DeleteBucket", { Bucket: bucket }).catch(() => {});
  }
});

test("S3: buckets of every region are listed with their region, and can be narrowed to the selected one", async ({
  page,
  target,
}) => {
  const bucket = uniq("e2e-region");
  const inRegion = (op: string, input: unknown) =>
    page.request.post(`/api/targets/${target.tid}/s3/${op}?region=us-west-2`, { data: input });
  try {
    expect((await (await inRegion("CreateBucket", { Bucket: bucket })).json()).ok).toBe(true);

    await page.goto(`${target.base}/s3`);
    await page.getByLabel("Region", { exact: true }).selectOption("us-east-1");
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: bucket }) });
    await expect(row).toContainText("us-west-2");

    await page.getByLabel("Only this region").click();
    await expect(page.getByRole("link", { name: bucket })).toHaveCount(0);

    await page.getByLabel("Region", { exact: true }).selectOption("us-west-2");
    await expect(page.getByRole("link", { name: bucket })).toBeVisible();
  } finally {
    await page
      .getByLabel("Region", { exact: true })
      .selectOption("us-east-1")
      .catch(() => {});
    await inRegion("DeleteBucket", { Bucket: bucket }).catch(() => {});
  }
});
