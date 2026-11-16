import { expect, type Page, test as base } from "@playwright/test";

type Target = { tid: string; base: string };

// Every test starts with the auto-created "Local emulator" target resolved.
export const test = base.extend<{
  target: Target;
  call: <T = any>(svc: string, op: string, input?: unknown) => Promise<T>;
}>({
  target: async ({ page }, use) => {
    await page.goto("/"); // loading the Targets page creates the Local emulator target when its credentials are mounted
    const targets = await (await page.request.get("/api/targets")).json();
    const tid = targets.find((t: any) => t.name === "Local emulator")?.id;
    if (!tid) throw new Error("Local emulator target missing: is the stack running with the emulator's files mounted?");
    await use({ tid, base: `/t/${tid}` });
  },
  // Direct API access for arranging state and asserting results, independent of the UI under test.
  call: async ({ page, target }, use) => {
    await use(async (svc, op, input = {}) => {
      const r = await page.request.post(`/api/targets/${target.tid}/${svc}/${op}`, { data: input });
      const j = await r.json();
      if (!j.ok) throw new Error(`${svc}.${op}: ${j.error?.name}: ${j.error?.message}`);
      return j.output;
    });
  },
});

export { expect };
export const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

// A table can't be deleted while it is still CREATING (the emulator rejects it), so cleanup must wait and retry
// instead of swallowing the error, or the table leaks into the next run.
export async function deleteTableReliably(
  call: (svc: string, op: string, input?: unknown) => Promise<any>,
  name: string,
) {
  for (let i = 0; i < 40; i++) {
    try {
      await call("dynamodb", "DeleteTable", { TableName: name });
      return;
    } catch (e) {
      if (/ResourceNotFound/.test(String(e))) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
