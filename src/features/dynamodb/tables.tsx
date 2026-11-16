"use client";
import { useQuery } from "@tanstack/react-query";
import { Plus, Table2, Trash2 } from "lucide-react";
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
import { Input, Label, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { callOp, useMutateOp } from "@/lib/aws-client";

import type { AttributeDef, KeySchemaEl } from "./marshal";

export type TableDesc = {
  TableName: string;
  TableStatus?: string;
  ItemCount?: number;
  KeySchema?: KeySchemaEl[];
  AttributeDefinitions?: AttributeDef[];
  BillingModeSummary?: { BillingMode?: string };
};

const keyLabel = (t: TableDesc) =>
  (t.KeySchema ?? [])
    .map(
      (k) =>
        `${k.AttributeName} (${t.AttributeDefinitions?.find((d) => d.AttributeName === k.AttributeName)?.AttributeType ?? "?"})`,
    )
    .join(" / ");

export function DynamoTables() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/dynamodb`;
  // One call per table, sequentially: the emulator drops connections under bursts of parallel requests.
  const tables = useQuery({
    queryKey: [tid, "dynamodb", "tables", region],
    queryFn: async () => {
      const { TableNames = [] } = await callOp<{ TableNames?: string[] }>(tid, "dynamodb", "ListTables", {}, region);
      const out: TableDesc[] = [];
      for (const TableName of TableNames)
        out.push((await callOp<{ Table: TableDesc }>(tid, "dynamodb", "DescribeTable", { TableName }, region)).Table);
      return out;
    },
    // Tables turn ACTIVE a moment after creation: keep polling while any is in transition.
    refetchInterval: (q) => (q.state.data?.some((t) => t.TableStatus && t.TableStatus !== "ACTIVE") ? 2000 : false),
  });
  const create = useMutateOp("dynamodb", "CreateTable");
  const del = useMutateOp("dynamodb", "DeleteTable");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", pk: "id", pkType: "S", sk: "", skType: "S" });

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="DynamoDB tables"
        description="Key-value and document tables."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create table
          </Button>
        }
      />
      {tables.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : tables.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {tables.error.message}
        </p>
      ) : (tables.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Table2 />}
          title="No tables"
          description="Create a table to store items."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create table
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Status</TH>
              <TH>Key</TH>
              <TH>Items</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {tables.data!.map((t) => (
              <TR key={t.TableName}>
                <TD>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`${base}/${encodeURIComponent(t.TableName)}`}
                  >
                    {t.TableName}
                  </Link>
                </TD>
                <TD>
                  <Badge variant={t.TableStatus === "ACTIVE" ? "success" : "warning"}>{t.TableStatus ?? "?"}</Badge>
                </TD>
                <TD className="font-mono text-xs text-muted-foreground">{keyLabel(t)}</TD>
                <TD className="text-muted-foreground">{t.ItemCount ?? 0}</TD>
                <TD className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete table ${t.TableName}`}
                    onClick={() => setDeleting(t.TableName)}
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
            <DialogTitle>Create table</DialogTitle>
            <DialogDescription>On-demand billing. Add a sort key for composite keys.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const AttributeDefinitions = [{ AttributeName: f.pk, AttributeType: f.pkType }];
              const KeySchema = [{ AttributeName: f.pk, KeyType: "HASH" }];
              if (f.sk.trim()) {
                AttributeDefinitions.push({ AttributeName: f.sk.trim(), AttributeType: f.skType });
                KeySchema.push({ AttributeName: f.sk.trim(), KeyType: "RANGE" });
              }
              await create
                .mutateAsync({ TableName: f.name, AttributeDefinitions, KeySchema, BillingMode: "PAY_PER_REQUEST" })
                .then(
                  () => {
                    setCreating(false);
                    setF({ ...f, name: "" });
                  },
                  () => {},
                );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="d-name">Table name</Label>
              <Input
                id="d-name"
                required
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="d-pk">Partition key</Label>
                <Input id="d-pk" required value={f.pk} onChange={(e) => setF({ ...f, pk: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-pkt">Type</Label>
                <Select id="d-pkt" value={f.pkType} onChange={(e) => setF({ ...f, pkType: e.target.value })}>
                  <option value="S">String</option>
                  <option value="N">Number</option>
                  <option value="B">Binary</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="d-sk">Sort key (optional)</Label>
                <Input id="d-sk" value={f.sk} onChange={(e) => setF({ ...f, sk: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-skt">Type</Label>
                <Select id="d-skt" value={f.skType} onChange={(e) => setF({ ...f, skType: e.target.value })}>
                  <option value="S">String</option>
                  <option value="N">Number</option>
                  <option value="B">Binary</option>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={!f.name || !f.pk || create.isPending}>{create.isPending && <Spinner />} Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete table “${deleting}”?`}
        description="All its items are deleted."
        typeToConfirm={deleting ?? undefined}
        onConfirm={() => del.mutateAsync({ TableName: deleting! })}
      />
    </div>
  );
}
