import { z } from "zod";

import { NOW, one, query } from "@/lib/db";
import { checkSteps } from "@/lib/fixture-check";
import { FileError, parseFixtureFile, planImport, secretSteps } from "@/lib/fixture-file";
import { sdkLookups } from "@/lib/fixture-lookups";
import { body, HttpError, json, route } from "@/lib/http";
import { fixtureCreate } from "@/lib/schemas";

const request = z.object({
  text: z.string().max(6_000_000),
  onConflict: z.enum(["rename", "replace", "skip"]).default("rename"),
  // true reads the file and says what an import would do, without changing anything
  dryRun: z.boolean().default(false),
});

type Item = {
  name: string;
  action: "create" | "rename" | "replace" | "skip" | "invalid";
  originalName?: string;
  steps?: number;
  errors?: number;
  warnings?: number;
  secrets?: { step: number; call: string; what: string }[];
  error?: string;
  id?: string;
};

// Reads a fixture file (one fixture or a bundle) and creates, renames, replaces or skips each fixture whose name
// exists. A fixture that is not valid is reported and does not stop the others.
export const POST = route(async (req) => {
  const { text, onConflict, dryRun } = await body(req, request);
  let raw: unknown[];
  try {
    raw = parseFixtureFile(text);
  } catch (e) {
    if (e instanceof FileError) throw new HttpError(400, e.message);
    throw e;
  }
  if (!raw.length) throw new HttpError(400, "The file has no fixtures");

  const parsed = raw.map((r) => fixtureCreate.safeParse(r));
  const valid = parsed.flatMap((p) => (p.success ? [p.data] : []));
  const seen = new Set<string>();
  const dupes = new Set(valid.filter((f) => seen.has(f.name) || !seen.add(f.name)).map((f) => f.name));

  const existing = new Map(
    (await query<{ id: string; name: string }>("select id, name from fixtures")).map((r) => [r.name, r.id]),
  );
  const plan = planImport(
    valid.filter((f) => !dupes.has(f.name)).map((f) => f.name),
    new Set(existing.keys()),
    onConflict,
  );

  const look = sdkLookups();
  const items: Item[] = [];
  let next = 0;
  for (const [i, p] of parsed.entries()) {
    if (!p.success) {
      const name =
        typeof (raw[i] as { name?: unknown } | null)?.name === "string"
          ? (raw[i] as { name: string }).name
          : "(no name)";
      items.push({
        name,
        action: "invalid",
        error: p.error.issues.map((x) => `${x.path.join(".") || "fixture"}: ${x.message}`).join("; "),
      });
      continue;
    }
    const f = p.data;
    if (dupes.has(f.name)) {
      items.push({ name: f.name, action: "invalid", error: "The name appears more than once in the file" });
      continue;
    }
    const planned = plan[next++]!;
    const problems = await checkSteps(f.steps, look);
    const item: Item = {
      name: planned.name,
      action: planned.action,
      ...(planned.name !== f.name ? { originalName: f.name } : {}),
      steps: f.steps.length,
      errors: problems.filter((x) => x.level === "error").length,
      warnings: problems.filter((x) => x.level === "warning").length,
      secrets: secretSteps(f.steps),
    };
    if (!dryRun && planned.action !== "skip") {
      const steps = JSON.stringify(f.steps);
      const row =
        planned.action === "replace"
          ? await one<{ id: string }>(
              `update fixtures set description = $2, steps = $3, updated_at = ${NOW} where id = $1 returning id`,
              [existing.get(planned.name)!, f.description, steps],
            )
          : await one<{ id: string }>("insert into fixtures(name, description, steps) values ($1,$2,$3) returning id", [
              planned.name,
              f.description,
              steps,
            ]);
      item.id = row!.id;
    }
    items.push(item);
  }
  return json({ dryRun, items });
});
