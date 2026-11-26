import { query } from "@/lib/db";
import { bundleFile } from "@/lib/fixture-file";
import { route } from "@/lib/http";

// Every fixture as one file (see the "Sharing fixtures" section of docs/fixtures.md).
export const GET = route(async () => {
  const rows = await query<{ name: string; description: string; steps: unknown[] }>(
    "select name, description, steps from fixtures order by name",
  );
  return new Response(bundleFile(rows), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="emulator-console-fixtures.json"',
    },
  });
});
