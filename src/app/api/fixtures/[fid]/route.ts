import { NOW, one } from "@/lib/db";
import { isUniqueViolation } from "@/lib/errors";
import { body, HttpError, json, route } from "@/lib/http";
import { getFixture } from "@/lib/repo";
import { fixtureUpdate } from "@/lib/schemas";

type P = { fid: string };

export const GET = route<P>(async (_req, { fid }) => {
  return json(await getFixture(fid));
});

export const PUT = route<P>(async (req, { fid }) => {
  await getFixture(fid);
  const u = await body(req, fixtureUpdate);
  try {
    const row = await one(
      `update fixtures set name = coalesce($2, name), description = coalesce($3, description),
         steps = coalesce($4, steps), updated_at = ${NOW} where id = $1 returning *`,
      [fid, u.name ?? null, u.description ?? null, u.steps ? JSON.stringify(u.steps) : null],
    );
    return json(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "a fixture with this name already exists");
    throw e;
  }
});

export const DELETE = route<P>(async (_req, { fid }) => {
  await getFixture(fid);
  await one("delete from fixtures where id = $1", [fid]);
  return json({ ok: true });
});
