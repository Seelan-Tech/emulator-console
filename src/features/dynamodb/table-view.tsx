"use client";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, EmptyState, JsonViewer, PageHeader, Spinner } from "@/components/common";
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
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { callOp, useMutateOp, useOp } from "@/lib/aws-client";

import { type Item, itemKey, itemTemplate, keyNames, marshalItem, unmarshalItem } from "./marshal";
import { buildRequest, emptySpec, keySchemaFor, type QuerySpec, type TableShape } from "./query";
import { QueryBuilder } from "./query-builder";
import type { TableDesc } from "./tables";

type Page = { Items?: Item[]; LastEvaluatedKey?: Item };

// A table cell's text: scalars as they are, nested values (lists, maps, sets) as compact JSON, long text clipped.
const show = (v: unknown) => {
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") s = String(v);
  else if (v === null || v === undefined) s = "";
  else s = JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
};

export function DynamoTableView({ table }: { table: string }) {
  const { tid, region } = useTarget();
  const desc = useOp<{ Table: TableDesc }>(
    "dynamodb",
    "DescribeTable",
    { TableName: table },
    {
      // A new table needs a moment before it accepts items: poll until it is ACTIVE.
      refetchInterval: (q) => (q.state.data && q.state.data.Table.TableStatus !== "ACTIVE" ? 1500 : false),
    },
  );
  const t = desc.data?.Table;
  const ks = useMemo(() => t?.KeySchema ?? [], [t]);
  const defs = t?.AttributeDefinitions ?? [];

  const [form, setForm] = useState<QuerySpec>(emptySpec());
  const [applied, setApplied] = useState<QuerySpec>(emptySpec());
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(0);
  const [startKeys, setStartKeys] = useState<(Item | undefined)[]>([undefined]);
  const pageCounts = useRef<number[]>([]); // matching items per visited page: with filters, pages are not all full
  const [editing, setEditing] = useState<{ original: Record<string, unknown> | null; text: string } | null>(null);
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);

  const shape = t as unknown as TableShape | undefined;
  const items = useQuery<Page, Error>({
    queryKey: [tid, "dynamodb", "items", table, applied, limit, startKeys[page], region],
    enabled: !!t,
    queryFn: () => {
      const r = buildRequest(shape!, table, applied, limit, startKeys[page]);
      return callOp<Page>(tid, "dynamodb", r.operation, r.input, region);
    },
  });
  const rows = useMemo(() => (items.data?.Items ?? []).map(unmarshalItem), [items.data]);
  const cols = useMemo(
    () => [
      ...new Set([
        ...keyNames(ks),
        ...(applied.index && shape ? keyNames(keySchemaFor(shape, applied.index)) : []),
        ...rows.flatMap(Object.keys),
      ]),
    ],
    [ks, shape, rows, applied.index],
  );
  const next = items.data?.LastEvaluatedKey;

  // Remember how many items each visited page held, so "Items x–y" stays right when filters make pages uneven.
  useEffect(() => {
    if (items.isSuccess) pageCounts.current[page] = rows.length;
  }, [items.isSuccess, rows.length, page]);
  const offset = pageCounts.current.slice(0, page).reduce((s, n) => s + (n ?? 0), 0);
  // After deleting the last item of a trailing page, step back to the previous page. This must only follow an
  // actual delete: a last page that is empty merely because a filter matched nothing in it is a valid result.
  const afterDelete = useRef(false);
  useEffect(() => {
    if (!items.isSuccess) return;
    if (rows.length) afterDelete.current = false;
    else if (afterDelete.current && page > 0 && !items.data?.LastEvaluatedKey) {
      afterDelete.current = false;
      setPage((p) => p - 1);
    }
  }, [items.isSuccess, rows.length, page, items.data]);

  const put = useMutateOp("dynamodb", "PutItem", { invalidate: ["dynamodb"] });
  const del = useMutateOp("dynamodb", "DeleteItem", {
    onSuccess: () => {
      afterDelete.current = true;
    },
  });

  function run() {
    try {
      buildRequest(shape!, table, form, limit);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    pageCounts.current = [];
    setApplied(form);
    setPage(0);
    setStartKeys([undefined]);
  }

  async function save() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editing!.text) as Record<string, unknown>;
    } catch (e) {
      return toast.error(`Not valid JSON: ${(e as Error).message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return toast.error("An item must be a JSON object");
    const missing = keyNames(ks).find((k) => parsed[k] === undefined || parsed[k] === "");
    if (missing) return toast.error(`Key attribute “${missing}” is required`);
    let item: Item;
    try {
      item = marshalItem(parsed);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    await put.mutateAsync({ TableName: table, Item: item }).then(
      () => {
        toast.success("Item saved");
        setEditing(null);
      },
      () => {},
    );
  }

  const keyChanged =
    editing?.original &&
    (() => {
      try {
        const p = JSON.parse(editing.text) as Record<string, unknown>;
        return keyNames(ks).some((k) => JSON.stringify(p[k]) !== JSON.stringify(editing.original![k]));
      } catch {
        return false;
      }
    })();

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <PageHeader
        title={table}
        description={
          t ? (
            <span className="font-mono text-xs">
              {ks.map((k) => `${k.AttributeName} (${k.KeyType === "HASH" ? "partition" : "sort"})`).join(" · ")}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Badge variant={t?.TableStatus === "ACTIVE" ? "success" : "warning"}>{t?.TableStatus ?? "…"}</Badge>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => items.refetch()}>
              {items.isFetching ? <Spinner /> : <RefreshCw />}
            </Button>
          </>
        }
      >
        <Link
          href={`/t/${tid}/dynamodb`}
          className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← Tables
        </Link>
      </PageHeader>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          {shape && (
            <QueryBuilder
              shape={shape}
              table={table}
              value={form}
              onChange={setForm}
              onRun={run}
              knownAttributes={cols}
            />
          )}
          <div className="mb-3">
            <Button
              variant="outline"
              disabled={t?.TableStatus !== "ACTIVE"}
              onClick={() => setEditing({ original: null, text: JSON.stringify(itemTemplate(ks, defs), null, 2) })}
            >
              <Plus /> New item
            </Button>
          </div>

          {!t || items.isLoading ? (
            <div className="grid gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : items.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {items.error.message}
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No items"
              description={
                next
                  ? "Nothing matched in this page of results. Use Next to keep searching."
                  : applied.mode === "query"
                    ? "Nothing matches that key."
                    : applied.filters.length
                      ? "Nothing matches the filters."
                      : "This table is empty. Create an item to get started."
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  {cols.map((c) => (
                    <TH key={c}>
                      {c}
                      {keyNames(ks).includes(c) && <span className="ml-1 text-primary">●</span>}
                    </TH>
                  ))}
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((r, i) => (
                  <TR
                    key={i}
                    className="cursor-pointer"
                    onClick={() => setEditing({ original: r, text: JSON.stringify(r, null, 2) })}
                  >
                    {cols.map((c) => (
                      <TD key={c} className="max-w-64 truncate font-mono text-xs">
                        {show(r[c])}
                      </TD>
                    ))}
                    <TD className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete item"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(r);
                        }}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft /> Previous
            </Button>
            <span className="text-muted-foreground" data-testid="page-info">
              {rows.length ? `Items ${offset + 1}–${offset + rows.length}` : "No items"} · page {page + 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!next}
              onClick={() => {
                setStartKeys((k) => {
                  const n = [...k];
                  n[page + 1] = next;
                  return n;
                });
                setPage(page + 1);
              }}
            >
              Next <ChevronRight />
            </Button>
            <label className="ml-auto flex items-center gap-2 text-muted-foreground">
              Per page
              <Select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(0);
                  setStartKeys([undefined]);
                  pageCounts.current = [];
                }}
                className="w-20"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </label>
          </div>
        </TabsContent>

        <TabsContent value="schema">
          {desc.data ? <JsonViewer value={desc.data.Table} /> : <Skeleton className="h-40" />}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent side="right">
          <DialogHeader>
            <DialogTitle>{editing?.original ? "Edit item" : "New item"}</DialogTitle>
            <DialogDescription>
              Plain JSON. Sets and binary use tags: <code>{`{"$ss":["a"]}`}</code>, <code>{`{"$ns":["1"]}`}</code>,{" "}
              <code>{`{"$b":"base64"}`}</code>.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <CodeEditor value={editing.text} onChange={(v) => setEditing({ ...editing, text: v })} height="55vh" />
          )}
          {keyChanged && (
            <p className="text-xs text-warning">
              The key changed: saving creates a new item and leaves the original in place.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={put.isPending}>
              {put.isPending && <Spinner />} Save item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this item?"
        description={
          deleting ? (
            <code className="text-xs">
              {JSON.stringify(Object.fromEntries(keyNames(ks).map((k) => [k, deleting[k]])))}
            </code>
          ) : undefined
        }
        onConfirm={() => del.mutateAsync({ TableName: table, Key: itemKey(deleting!, ks) })}
      />
    </div>
  );
}
