"use client";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Plus, RefreshCw, Trash2 } from "lucide-react";
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

import { counts, finalQueueName, isFifo, queueNameFromUrl, validateQueueName } from "./logic";

type Row = { url: string; name: string; attrs: Record<string, string> };

export function SqsQueues() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/sqs`;
  const [auto, setAuto] = useState(false);
  // One attributes call per queue, sequentially: the emulator drops connections under bursts.
  const queues = useQuery({
    queryKey: [tid, "sqs", "queues", region],
    queryFn: async (): Promise<Row[]> => {
      const { QueueUrls = [] } = await callOp<{ QueueUrls?: string[] }>(tid, "sqs", "ListQueues", {}, region);
      const rows: Row[] = [];
      for (const url of QueueUrls) {
        const { Attributes = {} } = await callOp<{ Attributes?: Record<string, string> }>(
          tid,
          "sqs",
          "GetQueueAttributes",
          { QueueUrl: url, AttributeNames: ["All"] },
          region,
        );
        rows.push({ url, name: queueNameFromUrl(url), attrs: Attributes });
      }
      return rows;
    },
    refetchInterval: auto ? 4000 : false,
  });
  const create = useMutateOp("sqs", "CreateQueue");
  const del = useMutateOp("sqs", "DeleteQueue");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fifo, setFifo] = useState(false);
  const [vis, setVis] = useState("30");
  const [deleting, setDeleting] = useState<Row | null>(null);
  const nameError = name ? validateQueueName(name, fifo) : null;

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="SQS queues"
        description="Message queues, standard and FIFO."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto-refresh" /> Auto-refresh
            </label>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => queues.refetch()}>
              {queues.isFetching ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create queue
            </Button>
          </>
        }
      />
      {queues.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : queues.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {queues.error.message}
        </p>
      ) : (queues.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No queues"
          description="Create a queue to send and receive messages."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create queue
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH className="text-right">Available</TH>
              <TH className="text-right">In flight</TH>
              <TH className="text-right">Delayed</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {queues.data!.map((q) => {
              const c = counts(q.attrs);
              return (
                <TR key={q.url}>
                  <TD>
                    <Link
                      className="font-medium text-primary hover:underline"
                      href={`${base}/${encodeURIComponent(q.name)}`}
                    >
                      {q.name}
                    </Link>
                  </TD>
                  <TD>
                    <Badge variant="outline">{isFifo(q.name) ? "FIFO" : "standard"}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{c.available}</TD>
                  <TD className="text-right text-muted-foreground tabular-nums">{c.inFlight}</TD>
                  <TD className="text-right text-muted-foreground tabular-nums">{c.delayed}</TD>
                  <TD className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete queue ${q.name}`}
                      onClick={() => setDeleting(q)}
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

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create queue</DialogTitle>
            <DialogDescription>FIFO queues keep order and deduplicate; the name gets a .fifo suffix.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const Attributes: Record<string, string> = { VisibilityTimeout: vis || "30" };
              if (fifo) {
                Attributes.FifoQueue = "true";
                Attributes.ContentBasedDeduplication = "true";
              }
              await create.mutateAsync({ QueueName: finalQueueName(name, fifo), Attributes }).then(
                () => {
                  setCreating(false);
                  setName("");
                },
                () => {},
              );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="q-name">Queue name</Label>
              <Input
                id="q-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                aria-invalid={!!nameError}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={fifo} onCheckedChange={setFifo} aria-label="FIFO" /> FIFO queue
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="q-vis">Visibility timeout (seconds)</Label>
              <Input id="q-vis" type="number" min={0} value={vis} onChange={(e) => setVis(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={!name || !!nameError || create.isPending}>
                {create.isPending && <Spinner />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete queue “${deleting?.name}”?`}
        description="All its messages are deleted."
        typeToConfirm={deleting?.name}
        onConfirm={() => del.mutateAsync({ QueueUrl: deleting!.url })}
      />
    </div>
  );
}
