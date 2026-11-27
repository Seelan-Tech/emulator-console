"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, CopyButton, EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutateOp, useOp, useRunOp } from "@/lib/aws-client";

import { AddTargetDialog } from "./add-target";
import { type Target, type TargetHealth, useTargetHealth } from "./health";
import { ruleTrigger, sampleEvent, targetHref, targetKind } from "./logic";
import { allowRuleOnTarget } from "./permissions";
import { type Rule, RuleDialog } from "./rule-dialog";

export function EventRuleView({ bus, rule }: { bus: string; rule: string }) {
  const { tid } = useTarget();
  const router = useRouter();
  const base = `/t/${tid}`;
  const described = useOp<Rule>("eventbridge", "DescribeRule", { Name: rule, EventBusName: bus });
  const targetsQ = useOp<{ Targets?: Target[] }>("eventbridge", "ListTargetsByRule", { Rule: rule, EventBusName: bus });
  const targets = targetsQ.data?.Targets ?? [];
  const r = described.data;
  const health = useTargetHealth(r?.Arn, targets);
  const enable = useMutateOp("eventbridge", "EnableRule");
  const disable = useMutateOp("eventbridge", "DisableRule");
  const removeTarget = useMutateOp("eventbridge", "RemoveTargets");
  const runOp = useRunOp();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);

  const attention = targets.filter((t) => {
    const h = health.data?.[t.Id];
    return h === "needs-permission" || h === "missing";
  }).length;

  async function fix(t: Target) {
    if (!r?.Arn) return;
    setFixing(t.Id);
    try {
      await allowRuleOnTarget(runOp, { targetArn: t.Arn, ruleArn: r.Arn, bus, rule });
      toast.success("Allowed this rule");
      await health.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setFixing(null);
  }

  async function deleteRule() {
    if (targets.length)
      await runOp("eventbridge", "RemoveTargets", { Rule: rule, EventBusName: bus, Ids: targets.map((t) => t.Id) });
    await runOp("eventbridge", "DeleteRule", { Name: rule, EventBusName: bus });
    router.push(`${base}/eventbridge/${encodeURIComponent(bus)}`);
  }

  const on = r?.State !== "DISABLED";
  const trigger = r ? ruleTrigger(r) : null;

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={rule}
        description={
          r?.Arn ? (
            <span className="flex items-center gap-1 font-mono text-xs">
              {r.Arn}
              <CopyButton value={r.Arn} label="Copy ARN" />
            </span>
          ) : undefined
        }
        actions={
          r ? (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={on}
                  aria-label="Enabled"
                  onCheckedChange={(v) => (v ? enable : disable).mutate({ Name: rule, EventBusName: bus })}
                />
                Enabled
              </label>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 className="text-destructive" /> Delete
              </Button>
            </div>
          ) : undefined
        }
      >
        <Link
          href={`${base}/eventbridge/${encodeURIComponent(bus)}`}
          className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← {bus}
        </Link>
      </PageHeader>

      {described.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {described.error.message}
        </p>
      ) : !r ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="mb-4 grid gap-1 text-sm">
            {r.Description ? <p>{r.Description}</p> : null}
            <p className="flex items-center gap-2">
              <Badge variant={on ? "success" : "outline"}>{on ? "enabled" : "disabled"}</Badge>
              {trigger?.kind === "schedule" ? (
                <>
                  Fires on a schedule: <code className="font-mono text-xs">{trigger.text}</code>
                </>
              ) : (
                "Fires on events that match this pattern:"
              )}
            </p>
            {trigger?.kind === "pattern" && (
              <CodeEditor
                value={(() => {
                  try {
                    return JSON.stringify(JSON.parse(r.EventPattern!), null, 2);
                  } catch {
                    return r.EventPattern ?? "";
                  }
                })()}
                readOnly
                beautify={false}
                height="140px"
                label="Event pattern of this rule"
              />
            )}
          </div>
          <Tabs defaultValue="targets">
            <TabsList>
              <TabsTrigger value="targets">
                Targets ({targets.length}
                {attention ? `, ${attention} need attention` : ""})
              </TabsTrigger>
              {trigger?.kind === "pattern" && <TabsTrigger value="test">Test the pattern</TabsTrigger>}
            </TabsList>

            <TabsContent value="targets">
              <div className="mb-3 flex justify-end">
                <Button onClick={() => setAdding(true)}>
                  <Plus /> Add target
                </Button>
              </div>
              {targetsQ.isLoading ? (
                <Skeleton className="h-24" />
              ) : targets.length === 0 ? (
                <EmptyState
                  title="No targets"
                  description="Without a target a matching event goes nowhere. Add a queue, a function or a topic."
                  action={
                    <Button onClick={() => setAdding(true)}>
                      <Plus /> Add target
                    </Button>
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Id</TH>
                      <TH>Target</TH>
                      <TH>Sends</TH>
                      <TH>Delivery</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {targets.map((t) => {
                      const href = targetHref(base, t.Arn);
                      return (
                        <TR key={t.Id}>
                          <TD className="font-mono text-xs">{t.Id}</TD>
                          <TD>
                            <Badge variant="outline" className="mr-1.5">
                              {targetKind(t.Arn) === "other" ? t.Arn.split(":")[2] : targetKind(t.Arn)}
                            </Badge>
                            {href ? (
                              <Link className="font-medium text-primary hover:underline" href={href}>
                                {t.Arn.split(":").slice(6).join(":") || t.Arn.split(":").pop()}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs">{t.Arn}</span>
                            )}
                          </TD>
                          <TD className="max-w-48 truncate font-mono text-xs" title={t.Input}>
                            {t.Input ?? <span className="text-muted-foreground">the event</span>}
                          </TD>
                          <TD>
                            <DeliveryCell
                              health={health.data?.[t.Id]}
                              loading={health.isLoading}
                              fixing={fixing === t.Id}
                              onFix={() => fix(t)}
                            />
                          </TD>
                          <TD className="text-right">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Remove target ${t.Id}`}
                              onClick={() => removeTarget.mutate({ Rule: rule, EventBusName: bus, Ids: [t.Id] })}
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
              <p className="mt-2 text-xs text-muted-foreground">
                EventBridge delivers to a queue, function or topic only if its policy allows this rule. Delivery checks
                that, one target at a time, when the tab opens.
              </p>
            </TabsContent>

            {trigger?.kind === "pattern" && (
              <TabsContent value="test">
                <PatternTester pattern={r.EventPattern!} />
              </TabsContent>
            )}
          </Tabs>
          <RuleDialog open={editing} onOpenChange={setEditing} bus={bus} rule={r} />
          {r.Arn && (
            <AddTargetDialog
              open={adding}
              onOpenChange={setAdding}
              bus={bus}
              rule={rule}
              ruleArn={r.Arn}
              existingIds={targets.map((t) => t.Id)}
            />
          )}
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={`Delete rule “${rule}”?`}
            description={targets.length ? `Its ${targets.length} target(s) are removed first.` : undefined}
            typeToConfirm={rule}
            onConfirm={deleteRule}
          />
        </>
      )}
    </div>
  );
}

const HEALTH_LABEL: Record<
  TargetHealth,
  { text: string; variant: "success" | "warning" | "destructive" | "outline"; hint: string }
> = {
  delivers: { text: "delivers", variant: "success", hint: "The target allows this rule." },
  "needs-permission": {
    text: "needs permission",
    variant: "warning",
    hint: "The target exists but does not allow this rule, so EventBridge cannot deliver to it.",
  },
  missing: { text: "target missing", variant: "destructive", hint: "The queue, function or topic does not exist." },
  unknown: { text: "unknown", variant: "outline", hint: "The check failed." },
  "not-checked": { text: "not checked", variant: "outline", hint: "Only queues, functions and topics are checked." },
};

function DeliveryCell(props: {
  health: TargetHealth | undefined;
  loading: boolean;
  fixing: boolean;
  onFix: () => void;
}) {
  if (!props.health) return props.loading ? <Spinner /> : <span className="text-muted-foreground">-</span>;
  const l = HEALTH_LABEL[props.health];
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={l.variant} title={l.hint}>
        {l.text}
      </Badge>
      {props.health === "needs-permission" && (
        <Button size="sm" variant="outline" disabled={props.fixing} onClick={props.onFix}>
          {props.fixing && <Spinner />} Fix
        </Button>
      )}
    </span>
  );
}

function PatternTester({ pattern }: { pattern: string }) {
  const test = useMutateOp<{ Result?: boolean }>("eventbridge", "TestEventPattern", { invalidate: [], record: false });
  const [event, setEvent] = useState(() => sampleEvent(pattern));
  const [result, setResult] = useState<boolean | null>(null);
  let invalid: string | null = null;
  try {
    const v: unknown = JSON.parse(event);
    if (v === null || typeof v !== "object" || Array.isArray(v)) invalid = "An event is a JSON object";
  } catch (e) {
    invalid = `Not valid JSON: ${(e as Error).message}`;
  }
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm text-muted-foreground">
        Checks an event against this rule&apos;s pattern, without sending anything.
      </p>
      <CodeEditor
        value={event}
        onChange={(v) => {
          setEvent(v);
          setResult(null);
        }}
        height="260px"
        label="Event to test"
      />
      {invalid && (
        <p className="text-xs text-destructive" role="alert">
          {invalid}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          disabled={!!invalid || test.isPending}
          onClick={async () => {
            const r = await test
              .mutateAsync({ EventPattern: pattern, Event: JSON.stringify(JSON.parse(event)) })
              .catch(() => null);
            if (r) setResult(!!r.Result);
          }}
        >
          {test.isPending && <Spinner />} Test
        </Button>
        {result !== null && (
          <Badge variant={result ? "success" : "destructive"} role="status">
            {result ? "matches" : "does not match"}
          </Badge>
        )}
      </div>
    </div>
  );
}
