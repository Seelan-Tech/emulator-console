import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/common";
import { FixtureCreate } from "@/components/fixture-create";
import { ExportAllButton, FixtureImport } from "@/components/fixture-share";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fixtures" };

export default async function Fixtures() {
  const rows = await query<{ id: string; name: string; description: string; step_count: number; updated_at: string }>(
    "select id, name, description, json_array_length(steps) as step_count, updated_at from fixtures order by name",
  );
  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <PageHeader
        title="Fixtures"
        description="The emulator keeps everything in memory. A fixture replays calls to rebuild its state after a restart."
        actions={
          <div className="flex gap-2">
            {rows.length ? <ExportAllButton /> : null}
            <FixtureImport />
            <FixtureCreate />
          </div>
        }
      />
      {rows.length ? (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Steps</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((f) => (
              <TR key={f.id}>
                <TD>
                  <Link className="font-medium text-primary hover:underline" href={`/fixtures/${f.id}`}>
                    {f.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                </TD>
                <TD>{f.step_count}</TD>
                <TD className="text-muted-foreground">{new Date(f.updated_at).toLocaleString()}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={<FlaskConical />}
          title="No fixtures yet"
          description="Open a target and make some changes: they are recorded automatically, then save them here. Or create an empty fixture and write the steps."
        />
      )}
    </main>
  );
}
