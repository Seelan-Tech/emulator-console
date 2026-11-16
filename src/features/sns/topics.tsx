"use client";
import { useQuery } from "@tanstack/react-query";
import { Bell, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog, EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { callOp, useMutateOp } from "@/lib/aws-client";

import { arnName, isFifoTopic } from "./logic";

type Row = { arn: string; attrs: Record<string, string> };

export function SnsTopics() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/sns`;
  // One attributes call per topic, sequentially: the emulator drops connections under bursts.
  const topics = useQuery({
    queryKey: [tid, "sns", "topics", region],
    queryFn: async (): Promise<Row[]> => {
      const { Topics = [] } = await callOp<{ Topics?: { TopicArn: string }[] }>(tid, "sns", "ListTopics", {}, region);
      const rows: Row[] = [];
      for (const t of Topics) {
        const { Attributes = {} } = await callOp<{ Attributes?: Record<string, string> }>(
          tid,
          "sns",
          "GetTopicAttributes",
          { TopicArn: t.TopicArn },
          region,
        );
        rows.push({ arn: t.TopicArn, attrs: Attributes });
      }
      return rows;
    },
  });
  const create = useMutateOp("sns", "CreateTopic");
  const del = useMutateOp("sns", "DeleteTopic");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fifo, setFifo] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="SNS topics"
        description="Publish once, deliver to many subscribers."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create topic
          </Button>
        }
      />
      {topics.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : topics.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {topics.error.message}
        </p>
      ) : (topics.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="No topics"
          description="Create a topic, then subscribe queues, functions or endpoints."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create topic
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH className="text-right">Subscriptions</TH>
              <TH className="text-right">Pending</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {topics.data!.map((t) => (
              <TR key={t.arn}>
                <TD>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`${base}/${encodeURIComponent(arnName(t.arn))}`}
                  >
                    {arnName(t.arn)}
                  </Link>
                </TD>
                <TD>
                  <Badge variant="outline">{isFifoTopic(t.arn) ? "FIFO" : "standard"}</Badge>
                </TD>
                <TD className="text-right tabular-nums">{t.attrs.SubscriptionsConfirmed ?? 0}</TD>
                <TD className="text-right text-muted-foreground tabular-nums">{t.attrs.SubscriptionsPending ?? 0}</TD>
                <TD className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete topic ${arnName(t.arn)}`}
                    onClick={() => setDeleting(t)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create topic</DialogTitle>
            <DialogDescription>FIFO topics keep order; the name gets a .fifo suffix.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const Name = fifo && !name.endsWith(".fifo") ? `${name}.fifo` : name;
              await create
                .mutateAsync({
                  Name,
                  ...(fifo ? { Attributes: { FifoTopic: "true", ContentBasedDeduplication: "true" } } : {}),
                })
                .then(
                  () => {
                    setCreating(false);
                    setName("");
                    setFifo(false);
                  },
                  () => {},
                );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="s-name">Topic name</Label>
              <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={fifo} onCheckedChange={setFifo} aria-label="FIFO" /> FIFO topic
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={!name || create.isPending}>{create.isPending && <Spinner />} Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete topic “${deleting ? arnName(deleting.arn) : ""}”?`}
        description="Its subscriptions are removed."
        typeToConfirm={deleting ? arnName(deleting.arn) : undefined}
        onConfirm={() => del.mutateAsync({ TopicArn: deleting!.arn })}
      />
    </div>
  );
}
