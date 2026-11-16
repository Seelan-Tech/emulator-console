import { History } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listAudit } from "@/lib/audit";
import { isUuid, query } from "@/lib/db";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };
const PAGE = 50;

const pill = (active: boolean) =>
  cn(
    "rounded-md px-2.5 py-1 text-sm transition-colors",
    active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
  );

export default async function Activity({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; target?: string; before?: string }>;
}) {
  const sp = await searchParams;
  const all = sp.all === "1";
  const target = sp.target && isUuid(sp.target) ? sp.target : undefined;
  const rows = await listAudit({ all, targetId: target, limit: PAGE + 1, before: Number(sp.before) || undefined });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const targets = await query<{ id: string; name: string }>("select id, name from targets order by name");
  const href = (o: { all?: boolean; target?: string; before?: string }) => {
    const q = new URLSearchParams();
    if (o.all) q.set("all", "1");
    if (o.target) q.set("target", o.target);
    if (o.before) q.set("before", o.before);
    return `/activity${q.size ? `?${q}` : ""}`;
  };
  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <PageHeader
        title="Activity"
        description="What changed, on which target, and whether you or a fixture did it. Request inputs are never stored."
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-1">
          <Link href={href({ target })} className={pill(!all)}>
            Changes only
          </Link>
          <Link href={href({ all: true, target })} className={pill(all)}>
            All calls
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm text-muted-foreground">Target</span>
          <Link href={href({ all })} className={pill(!target)}>
            Any
          </Link>
          {targets.map((t) => (
            <Link key={t.id} href={href({ all, target: t.id })} className={pill(target === t.id)}>
              {t.name}
            </Link>
          ))}
        </div>
      </div>
      {shown.length ? (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Source</TH>
              <TH>Target</TH>
              <TH>Call</TH>
              <TH>Result</TH>
              <TH className="text-right">ms</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap text-muted-foreground" title={new Date(r.created_at).toISOString()}>
                  {new Date(r.created_at).toLocaleString()}
                </TD>
                <TD>
                  <Badge variant="outline">{r.source}</Badge>
                </TD>
                <TD>{r.target_name ?? "(deleted)"}</TD>
                <TD className="font-mono text-xs">
                  {r.service}.{r.operation}
                </TD>
                <TD>
                  {r.ok ? (
                    <Badge variant="success">ok</Badge>
                  ) : (
                    <span className="text-destructive" title={r.error ?? ""}>
                      {(r.error ?? "failed").slice(0, 80)}
                    </span>
                  )}
                </TD>
                <TD className="text-right text-muted-foreground">{r.duration_ms}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={<History />}
          title="Nothing here yet"
          description="Calls made through the console appear here."
        />
      )}
      {more && (
        <div className="mt-4">
          <Link
            className="text-sm text-primary hover:underline"
            href={href({ all, target, before: String(shown.at(-1)?.id) })}
          >
            Older →
          </Link>
        </div>
      )}
    </main>
  );
}
