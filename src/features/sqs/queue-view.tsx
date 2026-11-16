"use client";
import { Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, CopyButton, EmptyState, JsonViewer, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutateOp, useOp } from "@/lib/aws-client";

import { type AttrRow, counts, isFifo, prettyBody, toMessageAttributes } from "./logic";

type Message = {
  MessageId: string;
  ReceiptHandle: string;
  Body: string;
  Attributes?: Record<string, string>;
  MessageAttributes?: Record<string, { StringValue?: string; DataType?: string }>;
};

export function SqsQueueView({ queue }: { queue: string }) {
  const { tid } = useTarget();
  const fifo = isFifo(queue);
  const url = useOp<{ QueueUrl: string }>("sqs", "GetQueueUrl", { QueueName: queue });
  const QueueUrl = url.data?.QueueUrl;
  const [auto, setAuto] = useState(false);
  const attrs = useOp<{ Attributes?: Record<string, string> }>(
    "sqs",
    "GetQueueAttributes",
    { QueueUrl, AttributeNames: ["All"] },
    { enabled: !!QueueUrl, refetchInterval: auto ? 3000 : false },
  );
  const c = counts(attrs.data?.Attributes);

  const send = useMutateOp<{ MessageId?: string }>("sqs", "SendMessage");
  const del = useMutateOp("sqs", "DeleteMessage", { record: false }); // a receipt handle can't be replayed
  const purge = useMutateOp("sqs", "PurgeQueue");
  const receive = useMutateOp<{ Messages?: Message[] }>("sqs", "ReceiveMessage", { record: false });

  const [body, setBody] = useState("");
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [delay, setDelay] = useState("");
  const [group, setGroup] = useState("");
  const [dedup, setDedup] = useState("");
  const [peek, setPeek] = useState(true);
  const [max, setMax] = useState("10");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [purging, setPurging] = useState(false);

  async function submit() {
    let MessageAttributes;
    try {
      MessageAttributes = toMessageAttributes(rows);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    const input: Record<string, unknown> = { QueueUrl, MessageBody: body };
    if (MessageAttributes) input.MessageAttributes = MessageAttributes;
    if (fifo) {
      if (!group.trim()) return toast.error("A FIFO queue needs a message group id");
      input.MessageGroupId = group.trim();
      if (dedup.trim()) input.MessageDeduplicationId = dedup.trim();
    } else if (delay) input.DelaySeconds = Number(delay);
    await send.mutateAsync(input).then(
      (r) => toast.success(`Sent ${r.MessageId}`),
      () => {},
    );
  }

  async function poll() {
    const input: Record<string, unknown> = {
      QueueUrl,
      MaxNumberOfMessages: Math.min(10, Math.max(1, Number(max) || 10)),
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"],
    };
    if (peek) input.VisibilityTimeout = 0; // stays available for the next poll
    await receive.mutateAsync(input).then(
      (r) => setMessages(r.Messages ?? []),
      () => {},
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={queue}
        description={QueueUrl ? <span className="font-mono text-xs">{QueueUrl}</span> : undefined}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto-refresh" /> Auto-refresh
            </label>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => attrs.refetch()}>
              {attrs.isFetching ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="outline" onClick={() => setPurging(true)}>
              <Trash2 /> Purge
            </Button>
          </>
        }
      >
        <Link href={`/t/${tid}/sqs`} className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Queues
        </Link>
      </PageHeader>

      <div className="mb-5 grid grid-cols-3 gap-3" data-testid="counts">
        {(
          [
            ["Available", c.available],
            ["In flight", c.inFlight],
            ["Delayed", c.delayed],
          ] as const
        ).map(([label, n]) => (
          <Card key={label}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div
                className="text-2xl font-semibold tabular-nums"
                data-testid={`count-${label.toLowerCase().replace(" ", "-")}`}
              >
                {n}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="send">
        <TabsList>
          <TabsTrigger value="send">Send</TabsTrigger>
          <TabsTrigger value="receive">Receive</TabsTrigger>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <Card>
            <CardContent className="grid gap-4 pt-4">
              <div className="grid gap-1.5">
                <Label>Message body</Label>
                <CodeEditor value={body} onChange={setBody} language="text" height="160px" />
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
              {fifo ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="grp">Message group id</Label>
                    <Input id="grp" value={group} onChange={(e) => setGroup(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="dd">Deduplication id (optional)</Label>
                    <Input id="dd" value={dedup} onChange={(e) => setDedup(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="grid gap-1.5 sm:w-48">
                  <Label htmlFor="dl">Delay (seconds)</Label>
                  <Input
                    id="dl"
                    type="number"
                    min={0}
                    max={900}
                    value={delay}
                    onChange={(e) => setDelay(e.target.value)}
                  />
                </div>
              )}
              <Button className="justify-self-start" onClick={submit} disabled={!QueueUrl || send.isPending}>
                {send.isPending ? <Spinner /> : <Send />} Send message
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receive">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={peek} onCheckedChange={setPeek} aria-label="Peek" /> Peek{" "}
              <span className="text-muted-foreground">(messages stay available)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Max{" "}
              <Input
                type="number"
                min={1}
                max={10}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                className="w-20"
                aria-label="Max messages"
              />
            </label>
            <Button onClick={poll} disabled={!QueueUrl || receive.isPending}>
              {receive.isPending && <Spinner />} Poll
            </Button>
            {messages && messages.length > 0 && (
              <Button
                variant="outline"
                onClick={async () => {
                  for (const m of messages) await del.mutateAsync({ QueueUrl, ReceiptHandle: m.ReceiptHandle });
                  setMessages([]);
                  toast.success("Deleted received messages");
                }}
              >
                Delete all received
              </Button>
            )}
          </div>
          {!peek && (
            <p className="mb-3 text-xs text-muted-foreground">
              Receiving hides messages for the queue&apos;s visibility timeout and counts as a delivery attempt.
            </p>
          )}
          {messages === null ? (
            <p className="text-sm text-muted-foreground">Press Poll to fetch messages.</p>
          ) : messages.length === 0 ? (
            <EmptyState title="No messages available" />
          ) : (
            <div className="grid gap-3" data-testid="messages">
              {messages.map((m) => {
                const b = prettyBody(m.Body);
                return (
                  <Card key={m.MessageId}>
                    <CardHeader className="flex-row items-center gap-2">
                      <CardTitle className="font-mono text-xs">{m.MessageId}</CardTitle>
                      <Badge variant="outline">received ×{m.Attributes?.ApproximateReceiveCount ?? "?"}</Badge>
                      <CopyButton value={m.Body} label="Copy body" className="ml-auto" />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete message"
                        onClick={async () => {
                          await del.mutateAsync({ QueueUrl, ReceiptHandle: m.ReceiptHandle }).then(
                            () => setMessages((x) => x?.filter((y) => y.MessageId !== m.MessageId) ?? null),
                            () => {},
                          );
                        }}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <pre
                        className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 text-xs"
                        data-testid="message-body"
                      >
                        {b.text}
                      </pre>
                      {m.MessageAttributes && Object.keys(m.MessageAttributes).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(m.MessageAttributes).map(([k, v]) => (
                            <Badge key={k} variant="outline">
                              {k} = {v.StringValue}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="attributes">
          {attrs.data?.Attributes ? <JsonViewer value={attrs.data.Attributes} /> : <Skeleton className="h-40" />}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={purging}
        onOpenChange={setPurging}
        title={`Purge “${queue}”?`}
        description="Deletes every message in the queue."
        onConfirm={async () => {
          await purge.mutateAsync({ QueueUrl });
          setMessages(null);
        }}
        confirmLabel="Purge"
      />
    </div>
  );
}
