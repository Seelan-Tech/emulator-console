import { one, query } from "@/lib/db";
import { isUniqueViolation } from "@/lib/errors";
import { body, HttpError, json, route } from "@/lib/http";
import { fixtureCreate } from "@/lib/schemas";

export const GET = route(async () =>
  json(
    await query(
      "select id, name, description, json_array_length(steps) as step_count, updated_at from fixtures order by name",
    ),
  ),
);

export const POST = route(async (req) => {
  const f = await body(req, fixtureCreate);
  try {
    const row = await one("insert into fixtures(name, description, steps) values ($1,$2,$3) returning id, name", [
      f.name,
      f.description,
      JSON.stringify(f.steps),
    ]);
    return json(row, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "a fixture with this name already exists");
    throw e;
  }
});
