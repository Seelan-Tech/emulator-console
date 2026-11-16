import { isUuid, one } from "./db";
import { HttpError } from "./http-error";

export type FixtureRow = {
  id: string;
  name: string;
  description: string;
  steps: unknown[];
  created_at: string;
  updated_at: string;
};

export async function getFixture(fixtureId: string): Promise<FixtureRow> {
  const f = isUuid(fixtureId) ? await one<FixtureRow>("select * from fixtures where id = $1", [fixtureId]) : undefined;
  if (!f) throw new HttpError(404, "fixture not found");
  return f;
}
