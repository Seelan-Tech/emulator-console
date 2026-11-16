import type { Page } from "@playwright/test";

import { expect, expectToast, test, uniq } from "./fixtures";

const typeInEditor = async (page: Page, text: string) => {
  await page.locator(".cm-content").first().click();
  await page.keyboard.insertText(text);
};

test("Secrets: create (name with a slash), reveal, version, tag, schedule delete, restore, force delete", async ({
  page,
  target,
  call,
}) => {
  const name = `e2e/${uniq("secret")}`;
  try {
    await page.goto(`${target.base}/secrets`);
    await page.getByRole("button", { name: "Create secret" }).first().click();
    await page.getByLabel("Name").fill("bad name");
    await expect(page.getByText(/Letters, digits/)).toBeVisible();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Description (optional)").fill("made by e2e");
    await typeInEditor(page, '{"user":"alice"}');
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name }).click();
    await expect(page).toHaveURL(/secrets\/detail\?name=/);

    // hidden until revealed
    await expect(page.getByTestId("secret-value")).toHaveCount(0);
    await page.getByRole("button", { name: "Reveal value" }).click();
    await expect(page.getByTestId("secret-value")).toContainText('"user": "alice"');
    await page.getByRole("button", { name: "Hide value" }).click();
    await expect(page.getByTestId("secret-value")).toHaveCount(0);

    // new version
    await page.locator(".cm-content").first().click();
    await page.keyboard.insertText('{"user":"bob"}');
    await page.getByRole("button", { name: "Save new version" }).click();
    await expectToast(page, "New version saved");
    await page.getByRole("button", { name: "Reveal value" }).click();
    await expect(page.getByTestId("secret-value")).toContainText('"user": "bob"');
    await page.getByRole("tab", { name: "Versions" }).click();
    await expect(page.getByText("AWSCURRENT")).toBeVisible();
    await expect(page.getByText("AWSPREVIOUS")).toBeVisible();

    // tags
    await page.getByRole("tab", { name: "Tags" }).click();
    await page.getByLabel("Tag key").fill("env");
    await page.getByLabel("Tag value").fill("dev");
    await page.getByRole("button", { name: "Add tag" }).click();
    await expect(page.getByRole("cell", { name: "env", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove tag env" }).click();
    await expect(page.getByRole("cell", { name: "env", exact: true })).toHaveCount(0);

    // schedule deletion -> restore
    await page.getByRole("tab", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Schedule deletion" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Schedule deletion" }).click();
    await expect(page.getByText("scheduled for deletion and its value can't be read")).toBeVisible();
    await page.getByRole("button", { name: "Restore secret" }).click();
    await expect(page.getByText("scheduled for deletion and its value can't be read")).toHaveCount(0);

    // force delete with typed confirmation, back to the list
    await page.getByRole("tab", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete immediately" }).click();
    await page.getByLabel("Confirmation").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/secrets$/);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  } finally {
    await call("secretsmanager", "DeleteSecret", { SecretId: name, ForceDeleteWithoutRecovery: true }).catch(() => {});
  }
});
