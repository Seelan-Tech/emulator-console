"use client";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
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
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { callOp, useMutateOp } from "@/lib/aws-client";

import { validateBusName } from "./logic";

type Row = { name: string; arn: string; rules: number };

export function EventBuses() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/eventbridge`;
  // One rules call per bus, sequentially: the emulator drops connections under bursts.
  const buses = useQuery({
    queryKey: [tid, "eventbridge", "buses", region],
    queryFn: async (): Promise<Row[]> => {
      const { EventBuses = [] } = await callOp<{ EventBuses?: { Name: string; Arn: string }[] }>(
        tid,
        "eventbridge",
        "ListEventBuses",
        {},
        region,
      );
      const rows: Row[] = [];
      for (const b of EventBuses) {
        const { Rules = [] } = await callOp<{ Rules?: unknown[] }>(
          tid,
          "eventbridge",
          "ListRules",
          { EventBusName: b.Name },
          region,
        );
        rows.push({ name: b.Name, arn: b.Arn, rules: Rules.length });
      }
      return rows.sort((a, b) => (a.name === "default" ? -1 : b.name === "default" ? 1 : a.name.localeCompare(b.name)));
    },
  });
  const create = useMutateOp("eventbridge", "CreateEventBus");
  const del = useMutateOp("eventbridge", "DeleteEventBus");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Row | null>(null);
  const nameError = name ? validateBusName(name) : null;

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="EventBridge"
        description="Event buses, the rules that match events on them, and where those rules send them."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create event bus
          </Button>
        }
      />
      {buses.isLoading ? (
        <div className="grid gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : buses.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {buses.error.message}
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH className="text-right">Rules</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {buses.data!.map((b) => (
              <TR key={b.arn}>
                <TD>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`${base}/${encodeURIComponent(b.name)}`}
                  >
                    {b.name}
                  </Link>
                  {b.name === "default" && (
                    <Badge variant="outline" className="ml-2">
                      default
                    </Badge>
                  )}
                </TD>
                <TD className="text-right tabular-nums">{b.rules}</TD>
                <TD className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={b.name === "default"}
                    title={b.name === "default" ? "The default event bus cannot be deleted" : undefined}
                    aria-label={`Delete event bus ${b.name}`}
                    onClick={() => setDeleting(b)}
                  >
                    <Trash2 className={b.name === "default" ? undefined : "text-destructive"} />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {buses.data?.length === 1 && buses.data[0]!.rules === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<CalendarClock />}
            title="No rules yet"
            description="Open the default bus (or create your own) and add a rule: an event pattern or a schedule, and the queues, functions or topics it sends to."
          />
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create event bus</DialogTitle>
            <DialogDescription>
              A custom bus keeps your application's events apart from the default one.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await create.mutateAsync({ Name: name }).then(
                () => {
                  setCreating(false);
                  setName("");
                },
                () => {},
              );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="eb-name">Bus name</Label>
              <Input
                id="eb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!nameError}
                autoFocus
              />
              {nameError && (
                <p className="text-xs text-destructive" role="alert">
                  {nameError}
                </p>
              )}
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
        title={`Delete event bus “${deleting?.name ?? ""}”?`}
        description={
          deleting?.rules ? "Delete its rules first: EventBridge refuses to delete a bus that has rules." : undefined
        }
        typeToConfirm={deleting?.name}
        onConfirm={() => del.mutateAsync({ Name: deleting!.name })}
      />
    </div>
  );
}
