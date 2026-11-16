import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Automated WCAG 2 A/AA checks (axe) on the main screens, in both themes. Only serious and critical findings fail:
// axe cannot judge everything, so this is a floor, not a certificate.
async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test("main screens have no serious accessibility violations", async ({ page, target }) => {
  const screens = [
    ["workspace", `/`],
    ["target overview", target.base],
    ["S3", `${target.base}/s3`],
    ["DynamoDB", `${target.base}/dynamodb`],
    ["SQS", `${target.base}/sqs`],
    ["Lambda", `${target.base}/lambda`],
    ["SNS", `${target.base}/sns`],
    ["Secrets Manager", `${target.base}/secrets`],
    ["operations", `${target.base}/s/ssm`],
    ["fixtures", `/fixtures`],
    ["activity", `/activity`],
  ] as const;
  const found: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [name, path] of screens) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      found.push(...(await violations(page)).map((v) => `[${theme}] ${name}: ${v}`));
    }
  }
  expect(found).toEqual([]);
});

test("the command palette is accessible", async ({ page, target }) => {
  await page.goto(target.base);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
