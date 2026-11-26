import { readFile } from "node:fs/promises";

import { expect, test, uniq } from "./fixtures";

test("a fixture is exported as a file and imported back, with a warning for secret values and a new name for a clash", async ({
  page,
}) => {
  const name = uniq("e2e-share");
  const made = await (
    await page.request.post("/api/fixtures", {
      data: {
        name,
        description: "shared",
        steps: [
          { service: "secretsmanager", operation: "CreateSecret", input: { Name: uniq("e2e-sec"), SecretString: "x" } },
        ],
      },
    })
  ).json();
  const created: string[] = [made.id];
  try {
    // export: the file holds a secret value, so the console asks first
    await page.goto(`/fixtures/${made.id}`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText("will contain values that may be secret")).toBeVisible();
    await expect(page.getByText(/Step 1: .*secretsmanager.CreateSecret.* has a secret value/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download anyway" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^e2e-share-.*\.fixture\.json$/);
    const path = await file.path();
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved).toMatchObject({ format: "emulator-console-fixture", version: 1, name, description: "shared" });
    expect(saved.steps).toHaveLength(1);

    // import into an empty slot: the name is free once the fixture is deleted
    await page.request.delete(`/api/fixtures/${made.id}`);
    await page.goto("/fixtures");
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByLabel("Fixture file", { exact: true }).setInputFiles(path);
    const preview = page.getByTestId("import-preview");
    await expect(preview).toContainText(name);
    await expect(preview).toContainText("New");
    await expect(preview).toContainText("Has values that may be secret");
    await page.getByRole("button", { name: "Import 1 fixture" }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();

    // import again: the name exists, so it is saved under a new one
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByLabel("Fixture file", { exact: true }).setInputFiles(path);
    await expect(page.getByTestId("import-preview")).toContainText(`${name} (2)`);
    await expect(page.getByTestId("import-preview")).toContainText("saved under a new name");
    await page.getByRole("button", { name: "Import 1 fixture" }).click();
    await expect(page.getByRole("link", { name: `${name} (2)` })).toBeVisible();

    // a file that is not a fixture file is explained, and nothing can be imported
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByLabel("Fixture file contents").fill('{"hello":1}');
    await expect(page.getByRole("alert")).toContainText("not a fixture file");
    await expect(page.getByRole("button", { name: "Import", exact: true }).last()).toBeDisabled();
    await page.keyboard.press("Escape");

    // export all is one file that holds both
    const all = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export all" }).click();
    await page.getByRole("button", { name: "Download anyway" }).click();
    const bundle = JSON.parse(await readFile(await (await all).path(), "utf8"));
    expect(bundle.format).toBe("emulator-console-fixtures");
    expect(bundle.fixtures.map((f: { name: string }) => f.name)).toEqual(expect.arrayContaining([name, `${name} (2)`]));
  } finally {
    const list: { id: string; name: string }[] = await (await page.request.get("/api/fixtures")).json();
    for (const f of list.filter((x) => x.name.startsWith(name) || created.includes(x.id)))
      await page.request.delete(`/api/fixtures/${f.id}`);
  }
});
