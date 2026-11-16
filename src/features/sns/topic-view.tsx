"use client";
import { Plus, Send, Trash2, X } from "lucide-react";
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
import { useMutateOp, useOp, useRunOp } from "@/lib/aws-client";

import {
  addTopicToQueuePolicy,
  arnName,
  endpointHint,
  isFifoTopic,
  type Protocol,
  PROTOCOLS,
  queueArnFromUrl,
  supportsRawDelivery,
} from "./logic";

type Sub = { SubscriptionArn: string; Protocol: string; Endpoint: string };

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
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((s, i) => {
                    const pending = s.SubscriptionArn === "PendingConfirmation";
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
              Email, SMS and HTTP(S) subscriptions stay pending: the emulator doesn&apos;t send confirmation messages.
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
      if (protocol === "sqs" && allow) {
        const queueName = arnName(endpoint);
        const { QueueUrl } = await runOp<{ QueueUrl: string }>("sqs", "GetQueueUrl", { QueueName: queueName });
        const { Attributes } = await runOp<{ Attributes?: { Policy?: string } }>("sqs", "GetQueueAttributes", {
          QueueUrl,
          AttributeNames: ["Policy"],
        });
        await runOp("sqs", "SetQueueAttributes", {
          QueueUrl,
          Attributes: { Policy: addTopicToQueuePolicy(Attributes?.Policy, endpoint, topicArn) },
        });
      }
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
                <option key={p}>{p}</option>
              ))}
            </Select>
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
