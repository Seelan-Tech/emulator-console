"use client";
import { useQuery } from "@tanstack/react-query";
import { Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, CopyButton, EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { callOp, useMutateOp, useRunOp } from "@/lib/aws-client";

import { ruleTrigger, validateDetail } from "./logic";
import { type Rule, RuleDialog } from "./rule-dialog";

type RuleRow = Rule & { targets: number };

export function EventBusView({ bus }: { bus: string }) {
  const { tid, region } = useTarget();
  const router = useRouter();
  const base = `/t/${tid}/eventbridge`;
  // A targets call per rule, sequentially: the emulator drops connections under bursts.
  const rules = useQuery({
    queryKey: [tid, "eventbridge", "rules", bus, region],
    queryFn: async (): Promise<RuleRow[]> => {
      const out: RuleRow[] = [];
      let token: string | undefined;
      for (let page = 0; page < 10; page++) {
        const r = await callOp<{ Rules?: Rule[]; NextToken?: string }>(
          tid,
          "eventbridge",
          "ListRules",
          { EventBusName: bus, ...(token ? { NextToken: token } : {}) },
          region,
        );
        for (const rule of r.Rules ?? []) {
          const { Targets = [] } = await callOp<{ Targets?: unknown[] }>(
            tid,
            "eventbridge",
            "ListTargetsByRule",
            { Rule: rule.Name, EventBusName: bus },
            region,
          );
          out.push({ ...rule, targets: Targets.length });
        }
        token = r.NextToken;
        if (!token) break;
      }
      return out.sort((a, b) => a.Name.localeCompare(b.Name));
    },
  });
  const enable = useMutateOp("eventbridge", "EnableRule");
  const disable = useMutateOp("eventbridge", "DisableRule");
  const runOp = useRunOp();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);

  async function deleteRule(r: RuleRow) {
    // EventBridge refuses to delete a rule that still has targets
    const { Targets = [] } = await runOp<{ Targets?: { Id: string }[] }>("eventbridge", "ListTargetsByRule", {
      Rule: r.Name,
      EventBusName: bus,
    });
    if (Targets.length)
      await runOp("eventbridge", "RemoveTargets", {
        Rule: r.Name,
        EventBusName: bus,
        Ids: Targets.map((t) => t.Id),
      });
    await runOp("eventbridge", "DeleteRule", { Name: r.Name, EventBusName: bus });
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader title={bus} description={<span className="text-xs">An event bus and its rules.</span>}>
        <Link href={base} className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Event buses
        </Link>
      </PageHeader>
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules{rules.data ? ` (${rules.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="send">Send events</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create rule
            </Button>
          </div>
          {rules.isLoading ? (
            <Skeleton className="h-32" />
          ) : rules.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {rules.error.message}
            </p>
          ) : rules.data!.length === 0 ? (
            <EmptyState
              title="No rules on this bus"
              description="A rule matches events by a pattern, or fires on a schedule, and sends them to its targets."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Create rule
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Enabled</TH>
                  <TH>Fires on</TH>
                  <TH className="text-right">Targets</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rules.data!.map((r) => {
                  const trigger = ruleTrigger(r);
                  const on = r.State !== "DISABLED";
                  return (
                    <TR key={r.Name}>
                      <TD>
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`${base}/${encodeURIComponent(bus)}/${encodeURIComponent(r.Name)}`}
                        >
                          {r.Name}
                        </Link>
                        {r.Description ? <div className="text-xs text-muted-foreground">{r.Description}</div> : null}
                      </TD>
                      <TD>
                        <Switch
                          checked={on}
                          aria-label={`${on ? "Disable" : "Enable"} rule ${r.Name}`}
                          onCheckedChange={(v) => (v ? enable : disable).mutate({ Name: r.Name, EventBusName: bus })}
                        />
                      </TD>
                      <TD className="max-w-xs">
                        <div className="truncate font-mono text-xs" title={trigger.text}>
                          {trigger.kind === "schedule" ? (
                            <Badge variant="outline" className="mr-1.5">
                              schedule
                            </Badge>
                          ) : null}
                          {trigger.text}
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums">{r.targets}</TD>
                      <TD className="text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete rule ${r.Name}`}
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="send">
          <SendEvents bus={bus} />
        </TabsContent>
      </Tabs>

      <RuleDialog
        open={creating}
        onOpenChange={setCreating}
        bus={bus}
        onSaved={(name) => router.push(`${base}/${encodeURIComponent(bus)}/${encodeURIComponent(name)}`)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete rule “${deleting?.Name ?? ""}”?`}
        description={deleting?.targets ? `Its ${deleting.targets} target(s) are removed first.` : undefined}
        typeToConfirm={deleting?.Name}
        onConfirm={() => deleteRule(deleting!)}
      />
    </div>
  );
}

function SendEvents({ bus }: { bus: string }) {
  const put = useMutateOp<{
    FailedEntryCount?: number;
    Entries?: { EventId?: string; ErrorCode?: string; ErrorMessage?: string }[];
  }>("eventbridge", "PutEvents", { invalidate: [] });
  const [source, setSource] = useState("my.app");
  const [detailType, setDetailType] = useState("order.created");
  const [detail, setDetail] = useState('{\n  "orderId": "1"\n}');
  const [last, setLast] = useState<string | null>(null);
  const detailError = validateDetail(detail);

  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm text-muted-foreground">
        Puts one event on <code>{bus}</code>. Rules whose pattern matches it send it to their targets.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ev-source">Source</Label>
          <Input id="ev-source" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ev-type">Detail type</Label>
          <Input id="ev-type" value={detailType} onChange={(e) => setDetailType(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Detail (JSON object)</Label>
        <CodeEditor value={detail} onChange={setDetail} height="140px" label="Event detail" />
        {detailError && (
          <p className="text-xs text-destructive" role="alert">
            {detailError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button
          disabled={!source.trim() || !detailType.trim() || !!detailError || put.isPending}
          onClick={async () => {
            const r = await put
              .mutateAsync({
                Entries: [
                  {
                    EventBusName: bus,
                    Source: source.trim(),
                    DetailType: detailType.trim(),
                    Detail: detail.trim() || "{}",
                  },
                ],
              })
              .catch(() => null);
            if (!r) return;
            const e = r.Entries?.[0];
            if (r.FailedEntryCount || !e?.EventId) return toast.error(e?.ErrorMessage ?? "The event was not accepted");
            setLast(e.EventId);
            toast.success(`Sent ${e.EventId}`);
          }}
        >
          {put.isPending ? <Spinner /> : <Send />} Send event
        </Button>
        {last && (
          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            {last} <CopyButton value={last} label="Copy event id" />
          </span>
        )}
      </div>
    </div>
  );
}
