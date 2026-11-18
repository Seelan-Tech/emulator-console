"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Send, Trash2, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { CopyButton, EmptyState, JsonViewer, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AttrRow, toMessageAttributes } from "@/features/sqs/logic";
import { callOp, OpError, useMutateOp, useOp, useRunOp } from "@/lib/aws-client";

import {
  addTopicToQueuePolicy,
  arnName,
  deliversOnEmulator,
  endpointHint,
  isFifoTopic,
  lambdaStatementId,
  type Protocol,
  PROTOCOLS,
  queueArnFromUrl,
  subscriptionHealth,
  supportsRawDelivery,
  type TargetState,
} from "./logic";

type Sub = { SubscriptionArn: string; Protocol: string; Endpoint: string };
type RunOp = ReturnType<typeof useRunOp>;

// Without these statements SNS cannot deliver, and nothing tells you so. Shared by the Subscribe dialog and Fix.
async function allowTopicInQueue(runOp: RunOp, queueArn: string, topicArn: string) {
  const { QueueUrl } = await runOp<{ QueueUrl: string }>("sqs", "GetQueueUrl", { QueueName: arnName(queueArn) });
  const { Attributes } = await runOp<{ Attributes?: { Policy?: string } }>("sqs", "GetQueueAttributes", {
    QueueUrl,
    AttributeNames: ["Policy"],
  });
  await runOp("sqs", "SetQueueAttributes", {
    QueueUrl,
    Attributes: { Policy: addTopicToQueuePolicy(Attributes?.Policy, queueArn, topicArn) },
  });
}

async function allowTopicInFunction(runOp: RunOp, functionArn: string, topicArn: string) {
  await runOp("lambda", "AddPermission", {
    FunctionName: functionArn,
    StatementId: lambdaStatementId(topicArn),
    Action: "lambda:InvokeFunction",
    Principal: "sns.amazonaws.com",
    SourceArn: topicArn,
  }).catch((e: unknown) => {
    // already allowed (this topic was subscribed before): nothing to add
    if (!(e instanceof OpError && e.awsName === "ResourceConflictException")) throw e;
  });
}

const isMissing = (e: unknown) =>
  e instanceof OpError && /NonExistent|DoesNotExist|ResourceNotFound/.test(e.awsName ?? "");

// Reads the target of every deliverable subscription, one call at a time (the emulator drops connections under bursts).
async function readTargets(tid: string, region: string | undefined, subs: Sub[]) {
  const out: Record<string, TargetState> = {};
  for (const s of subs) {
    if (s.SubscriptionArn === "PendingConfirmation") continue;
    try {
      if (s.Protocol === "sqs") {
        const { QueueUrl } = await callOp<{ QueueUrl: string }>(
          tid,
          "sqs",
          "GetQueueUrl",
          { QueueName: arnName(s.Endpoint) },
          region,
        );
        const { Attributes } = await callOp<{ Attributes?: { Policy?: string } }>(
          tid,
          "sqs",
          "GetQueueAttributes",
          { QueueUrl, AttributeNames: ["Policy"] },
          region,
        );
        out[s.SubscriptionArn] = { exists: true, policy: Attributes?.Policy };
      } else if (s.Protocol === "lambda") {
        await callOp(tid, "lambda", "GetFunctionConfiguration", { FunctionName: s.Endpoint }, region);
        const policy = await callOp<{ Policy?: string }>(
          tid,
          "lambda",
          "GetPolicy",
          { FunctionName: s.Endpoint },
          region,
        ).then(
          (r) => r.Policy,
          (e: unknown) => {
            if (isMissing(e)) return undefined; // the function exists but has no policy yet
            throw e;
          },
        );
        out[s.SubscriptionArn] = { exists: true, policy };
      }
    } catch (e) {
      out[s.SubscriptionArn] = isMissing(e) ? { exists: false } : undefined;
    }
  }
  return out;
}

export function SnsTopicView({ topic }: { topic: string }) {
  const { tid, region } = useTarget();
  const fifo = isFifoTopic(topic);
  const topics = useOp<{ Topics?: { TopicArn: string }[] }>("sns", "ListTopics");
  const TopicArn = topics.data?.Topics?.find((t) => arnName(t.TopicArn) === topic)?.TopicArn;
  const attrs = useOp<{ Attributes?: Record<string, string> }>(
    "sns",
    "GetTopicAttributes",
    { TopicArn },
    { enabled: !!TopicArn },
  );
  const subs = useOp<{ Subscriptions?: Sub[] }>(
    "sns",
    "ListSubscriptionsByTopic",
    { TopicArn },
    { enabled: !!TopicArn },
  );
  const publish = useMutateOp<{ MessageId?: string }>("sns", "Publish", { invalidate: [] });
  const unsubscribe = useMutateOp("sns", "Unsubscribe");

  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [group, setGroup] = useState("");
  const [dedup, setDedup] = useState("");
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [subscribing, setSubscribing] = useState(false);

  async function send() {
    let MessageAttributes;
    try {
      MessageAttributes = toMessageAttributes(rows);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    const input: Record<string, unknown> = { TopicArn, Message: message };
    if (subject.trim()) input.Subject = subject.trim();
    if (MessageAttributes) input.MessageAttributes = MessageAttributes;
    if (fifo) {
      if (!group.trim()) return toast.error("A FIFO topic needs a message group id");
      input.MessageGroupId = group.trim();
      if (dedup.trim()) input.MessageDeduplicationId = dedup.trim();
    }
    await publish.mutateAsync(input).then(
      (r) => toast.success(`Published ${r.MessageId}`),
      () => {},
    );
  }

  const list = subs.data?.Subscriptions ?? [];
  const runOp = useRunOp();
  const qc = useQueryClient();
  const [fixing, setFixing] = useState<string>();
  const health = useQuery({
    queryKey: [tid, "sns", "health", TopicArn, region, list.map((x) => x.SubscriptionArn).join(",")],
    queryFn: () => readTargets(tid, region, list),
    enabled: !!TopicArn && subs.isSuccess && list.length > 0,
  });

  async function fix(s: Sub, kind: "queue-policy" | "lambda-permission") {
    if (!TopicArn) return;
    setFixing(s.SubscriptionArn);
    try {
      if (kind === "queue-policy") await allowTopicInQueue(runOp, s.Endpoint, TopicArn);
      else await allowTopicInFunction(runOp, s.Endpoint, TopicArn);
      toast.success("Topic allowed");
      await qc.invalidateQueries({ queryKey: [tid, "sns", "health"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
    setFixing(undefined);
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={topic}
        description={
          TopicArn ? (
            <span className="flex items-center gap-1 font-mono text-xs">
              {TopicArn}
              <CopyButton value={TopicArn} label="Copy ARN" />
            </span>
          ) : undefined
        }
      >
        <Link href={`/t/${tid}/sns`} className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Topics
        </Link>
      </PageHeader>
      {!TopicArn ? (
        <Skeleton className="h-40" />
      ) : (
        <Tabs defaultValue="publish">
          <TabsList>
            <TabsTrigger value="publish">Publish</TabsTrigger>
            <TabsTrigger value="subscriptions">Subscriptions ({list.length})</TabsTrigger>
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
          </TabsList>

          <TabsContent value="publish">
            <Card>
              <CardContent className="grid gap-4 pt-4">
                <div className="grid gap-1.5">
                  <Label>Message</Label>
                  <CodeEditor value={message} onChange={setMessage} language="text" height="160px" />
                </div>
                <div className="grid gap-1.5 sm:w-96">
                  <Label htmlFor="subj">Subject (optional)</Label>
                  <Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Message attributes</Label>
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="name"
                        aria-label={`Attribute ${i + 1} name`}
                        value={r.name}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                      <Select
                        className="w-28"
                        aria-label={`Attribute ${i + 1} type`}
                        value={r.type}
                        onChange={(e) =>
                          setRows(rows.map((x, j) => (j === i ? { ...x, type: e.target.value as AttrRow["type"] } : x)))
                        }
                      >
                        <option>String</option>
                        <option>Number</option>
                      </Select>
                      <Input
                        placeholder="value"
                        aria-label={`Attribute ${i + 1} value`}
                        value={r.value}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove attribute"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => setRows([...rows, { name: "", type: "String", value: "" }])}
                  >
                    <Plus /> Add attribute
                  </Button>
                </div>
                {fifo && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="g">Message group id</Label>
                      <Input id="g" value={group} onChange={(e) => setGroup(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="d">Deduplication id (optional)</Label>
                      <Input id="d" value={dedup} onChange={(e) => setDedup(e.target.value)} />
                    </div>
                  </div>
                )}
                <Button className="justify-self-start" onClick={send} disabled={publish.isPending}>
                  {publish.isPending ? <Spinner /> : <Send />} Publish
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subscriptions">
            <div className="mb-3">
              <Button onClick={() => setSubscribing(true)}>
                <Plus /> Subscribe
              </Button>{" "}
              <Button
                variant="outline"
                size="icon"
                aria-label="Recheck health"
                disabled={health.isFetching}
                onClick={() => health.refetch()}
              >
                {health.isFetching ? <Spinner /> : <RefreshCw />}
              </Button>
            </div>
            {list.length === 0 ? (
              <EmptyState
                title="No subscriptions"
                description="Subscribe a queue, function or endpoint to receive what you publish."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Protocol</TH>
                    <TH>Endpoint</TH>
                    <TH>Status</TH>
                    <TH>Health</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((s, i) => {
                    const pending = s.SubscriptionArn === "PendingConfirmation";
                    const h = health.data
                      ? subscriptionHealth(s, TopicArn, health.data[s.SubscriptionArn])
                      : deliversOnEmulator(s.Protocol as Protocol) && !pending
                        ? undefined
                        : subscriptionHealth(s, TopicArn, undefined);
                    return (
                      <TR key={i}>
                        <TD>
                          <Badge variant="outline">{s.Protocol}</Badge>
                        </TD>
                        <TD className="font-mono text-xs">{s.Endpoint}</TD>
                        <TD>
                          {pending ? (
                            <Badge variant="warning">pending confirmation</Badge>
                          ) : (
                            <Badge variant="success">confirmed</Badge>
                          )}
                        </TD>
                        <TD data-testid="sub-health">
                          {h ? (
                            <span className="flex items-center gap-2">
                              <Badge
                                variant={
                                  h.status === "ok" ? "success" : h.status === "error" ? "destructive" : "warning"
                                }
                                title={h.message}
                              >
                                {h.status === "ok" ? "healthy" : h.status === "error" ? "broken" : h.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{h.message}</span>
                              {h.fix && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={fixing === s.SubscriptionArn}
                                  onClick={() => fix(s, h.fix!)}
                                >
                                  {fixing === s.SubscriptionArn ? <Spinner /> : <Wrench />} Fix
                                </Button>
                              )}
                            </span>
                          ) : (
                            <Skeleton className="h-5 w-24" />
                          )}
                        </TD>
                        <TD className="text-right">
                          {!pending && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Unsubscribe ${s.Endpoint}`}
                              onClick={() => unsubscribe.mutate({ SubscriptionArn: s.SubscriptionArn })}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Email, SMS and HTTP(S) subscriptions stay pending and receive nothing: the emulator doesn&apos;t send
              confirmation messages.
            </p>
          </TabsContent>

          <TabsContent value="attributes">
            {attrs.data?.Attributes ? <JsonViewer value={attrs.data.Attributes} /> : <Skeleton className="h-40" />}
          </TabsContent>
        </Tabs>
      )}
      {TopicArn && (
        <SubscribeDialog open={subscribing} onOpenChange={setSubscribing} topicArn={TopicArn} region={region} />
      )}
    </div>
  );
}

function SubscribeDialog({
  open,
  onOpenChange,
  topicArn,
  region,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  topicArn: string;
  region: string;
}) {
  const runOp = useRunOp();
  const [protocol, setProtocol] = useState<Protocol>("sqs");
  const [endpoint, setEndpoint] = useState("");
  const [raw, setRaw] = useState(false);
  const [allow, setAllow] = useState(true);
  const [allowFn, setAllowFn] = useState(true);
  const [busy, setBusy] = useState(false);

  // Endpoint suggestions: this target's queues and functions.
  const queues = useOp<{ QueueUrls?: string[] }>("sqs", "ListQueues", {}, { enabled: open && protocol === "sqs" });
  const fns = useOp<{ Functions?: { FunctionArn: string }[] }>(
    "lambda",
    "ListFunctions",
    {},
    { enabled: open && protocol === "lambda" },
  );
  const suggestions =
    protocol === "sqs"
      ? (queues.data?.QueueUrls ?? []).map((u) => queueArnFromUrl(u, region))
      : protocol === "lambda"
        ? (fns.data?.Functions ?? []).map((f) => f.FunctionArn)
        : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (protocol === "sqs" && allow) await allowTopicInQueue(runOp, endpoint, topicArn);
      if (protocol === "lambda" && allowFn) await allowTopicInFunction(runOp, endpoint, topicArn);
      await runOp("sns", "Subscribe", {
        TopicArn: topicArn,
        Protocol: protocol,
        Endpoint: endpoint,
        ReturnSubscriptionArn: true,
        ...(raw && supportsRawDelivery(protocol) ? { Attributes: { RawMessageDelivery: "true" } } : {}),
      });
      toast.success("Subscribed");
      setEndpoint("");
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe to {arnName(topicArn)}</DialogTitle>
          <DialogDescription>Choose where published messages are delivered.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-proto">Protocol</Label>
            <Select
              id="sub-proto"
              value={protocol}
              onChange={(e) => {
                setProtocol(e.target.value as Protocol);
                setEndpoint("");
              }}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {deliversOnEmulator(p) ? p : `${p} (will not deliver)`}
                </option>
              ))}
            </Select>
            {!deliversOnEmulator(protocol) && (
              <p className="text-xs text-warning" role="note">
                The emulator never confirms {protocol} subscriptions, so published messages are not delivered to them.
                Use sqs or lambda to receive messages.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-ep">Endpoint</Label>
            <Input
              id="sub-ep"
              required
              list="sub-suggestions"
              placeholder={endpointHint[protocol]}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              autoComplete="off"
            />
            <datalist id="sub-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          {supportsRawDelivery(protocol) && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={raw} onCheckedChange={(v) => setRaw(v === true)} aria-label="Raw message delivery" />{" "}
              Raw message delivery
            </label>
          )}
          {protocol === "sqs" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allow}
                onCheckedChange={(v) => setAllow(v === true)}
                aria-label="Allow topic in queue policy"
              />{" "}
              Allow this topic in the queue&apos;s policy{" "}
              <span className="text-muted-foreground">(required for delivery)</span>
            </label>
          )}
          {protocol === "lambda" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allowFn}
                onCheckedChange={(v) => setAllowFn(v === true)}
                aria-label="Allow topic to invoke the function"
              />{" "}
              Allow this topic to invoke the function{" "}
              <span className="text-muted-foreground">(required for delivery)</span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!endpoint || busy}>{busy && <Spinner />} Subscribe</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
