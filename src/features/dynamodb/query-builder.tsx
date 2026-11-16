"use client";
import { Code2, Filter as FilterIcon, Play, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import {
  buildRequest,
  consistentAllowed,
  emptyFilter,
  emptySpec,
  type Filter,
  FILTER_OPS,
  indexes,
  keySchemaFor,
  needsValue,
  type QuerySpec,
  type Request,
  SORT_OPS,
  type SortOp,
  type TableShape,
  toCli,
  type ValueType,
} from "./query";

const typeLabel = (t?: string) => (t === "N" ? "number" : t === "B" ? "binary" : "string");

// The form for building a Query or Scan: source (table or index), key condition, filters, order, consistency.
// Owns validation (via buildRequest) so errors appear before anything is sent.
export function QueryBuilder({
  shape,
  table,
  value,
  onChange,
  onRun,
  knownAttributes,
  disabled,
}: {
  shape: TableShape;
  table: string;
  value: QuerySpec;
  onChange: (s: QuerySpec) => void;
  onRun: () => void;
  knownAttributes: string[];
  disabled?: boolean;
}) {
  const [showRequest, setShowRequest] = useState(false);
  const ks = keySchemaFor(shape, value.index);
  const hash = ks.find((k) => k.KeyType === "HASH")!.AttributeName;
  const range = ks.find((k) => k.KeyType === "RANGE")?.AttributeName;
  const defs = shape.AttributeDefinitions;
  const t = (name?: string) => defs.find((d) => d.AttributeName === name)?.AttributeType;
  const set = (patch: Partial<QuerySpec>) => onChange({ ...value, ...patch });
  const setFilter = (i: number, patch: Partial<Filter>) =>
    set({ filters: value.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const idx = indexes(shape);

  let request: Request | null = null;
  let previewError = "";
  try {
    request = buildRequest(shape, table, value, 25);
  } catch (e) {
    previewError = (e as Error).message;
  }
  const preview = request
    ? JSON.stringify({ operation: request.operation, ...request.input, Limit: undefined }, null, 2)
    : "";
  const cli = request ? toCli(request) : "";

  const run = () => {
    if (previewError) toast.error(previewError);
    else onRun();
  };
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") run();
  };

  return (
    <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3" data-testid="query-builder">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={value.mode}
          onChange={(e) => set({ mode: e.target.value as QuerySpec["mode"] })}
          className="w-28"
          aria-label="Mode"
        >
          <option value="scan">Scan</option>
          <option value="query">Query</option>
        </Select>
        <Select
          value={value.index}
          onChange={(e) => set({ index: e.target.value, pk: "", sk: "", sk2: "" })}
          className="max-w-64"
          aria-label="Index"
        >
          <option value="">Table: {table}</option>
          {idx.map((i) => (
            <option key={i.IndexName} value={i.IndexName}>
              {i.IndexName} ({i.KeySchema.map((k) => k.AttributeName).join(", ")})
            </option>
          ))}
        </Select>
        {value.mode === "query" && (
          <>
            <Input
              className="w-48"
              placeholder={`${hash} (${typeLabel(t(hash))}) =`}
              aria-label="Partition key value"
              value={value.pk}
              onChange={(e) => set({ pk: e.target.value })}
              onKeyDown={enter}
            />
            {range && (
              <>
                <Select
                  value={value.skOp}
                  onChange={(e) => set({ skOp: e.target.value as SortOp })}
                  className="w-32"
                  aria-label="Sort key operator"
                >
                  {SORT_OPS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
                <Input
                  className="w-40"
                  placeholder={`${range} (${typeLabel(t(range))}, optional)`}
                  aria-label="Sort key value"
                  value={value.sk}
                  onChange={(e) => set({ sk: e.target.value })}
                  onKeyDown={enter}
                />
                {value.skOp === "between" && (
                  <>
                    <span className="text-sm text-muted-foreground">and</span>
                    <Input
                      className="w-40"
                      placeholder={range}
                      aria-label="Sort key upper bound"
                      value={value.sk2}
                      onChange={(e) => set({ sk2: e.target.value })}
                      onKeyDown={enter}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {value.filters.length > 0 && (
        <div className="grid gap-2" data-testid="filters">
          {value.filters.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">{i === 0 ? "Where" : value.join}</span>
              <Input
                className="w-44"
                list="ddb-attrs"
                placeholder="attribute"
                aria-label={`Filter ${i + 1} attribute`}
                value={f.attr}
                onChange={(e) => setFilter(i, { attr: e.target.value })}
              />
              <Select
                className="w-36"
                aria-label={`Filter ${i + 1} operator`}
                value={f.op}
                onChange={(e) => setFilter(i, { op: e.target.value as Filter["op"] })}
              >
                {FILTER_OPS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {needsValue(f.op) && (
                <>
                  <Select
                    className="w-28"
                    aria-label={`Filter ${i + 1} type`}
                    value={f.type}
                    onChange={(e) =>
                      setFilter(i, {
                        type: e.target.value as ValueType,
                        value: e.target.value === "BOOL" ? "true" : f.value,
                      })
                    }
                  >
                    <option value="S">string</option>
                    <option value="N">number</option>
                    <option value="BOOL">boolean</option>
                  </Select>
                  {f.type === "BOOL" ? (
                    <Select
                      className="w-28"
                      aria-label={`Filter ${i + 1} value`}
                      value={f.value}
                      onChange={(e) => setFilter(i, { value: e.target.value })}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </Select>
                  ) : (
                    <Input
                      className="w-48"
                      placeholder="value"
                      aria-label={`Filter ${i + 1} value`}
                      value={f.value}
                      onChange={(e) => setFilter(i, { value: e.target.value })}
                      onKeyDown={enter}
                    />
                  )}
                </>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove filter ${i + 1}`}
                onClick={() => set({ filters: value.filters.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            </div>
          ))}
          <datalist id="ddb-attrs">
            {knownAttributes.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => set({ filters: [...value.filters, emptyFilter()] })}>
          <FilterIcon /> Add filter
        </Button>
        {value.filters.length > 1 && (
          <Select
            className="w-36"
            aria-label="Combine filters"
            value={value.join}
            onChange={(e) => set({ join: e.target.value as "AND" | "OR" })}
          >
            <option value="AND">all (AND)</option>
            <option value="OR">any (OR)</option>
          </Select>
        )}
        {value.mode === "query" && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={value.descending}
              onCheckedChange={(v) => set({ descending: v })}
              aria-label="Descending order"
            />{" "}
            Descending
          </label>
        )}
        <label
          className={`flex items-center gap-2 text-sm ${consistentAllowed(shape, value.index) ? "text-muted-foreground" : "text-muted-foreground/50"}`}
          title={
            consistentAllowed(shape, value.index) ? undefined : "Global secondary indexes are eventually consistent"
          }
        >
          <Switch
            checked={value.consistent && consistentAllowed(shape, value.index)}
            onCheckedChange={(v) => set({ consistent: v })}
            disabled={!consistentAllowed(shape, value.index)}
            aria-label="Consistent read"
          />{" "}
          Consistent read
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowRequest(!showRequest)} aria-expanded={showRequest}>
            <Code2 /> {showRequest ? "Hide request" : "Show request"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(emptySpec())}>
            <RotateCcw /> Reset
          </Button>
          <Button onClick={run} disabled={disabled}>
            <Play /> Run
          </Button>
        </div>
      </div>

      {showRequest && (
        <div className="grid gap-2" data-testid="request-preview">
          {previewError ? (
            <p className="text-xs text-warning">{previewError}</p>
          ) : (
            <>
              <div className="relative rounded-md border bg-muted/40">
                <CopyButton value={preview} label="Copy request" className="absolute top-1 right-1" />
                <pre className="max-h-64 overflow-auto p-3 pr-10 text-xs">{preview}</pre>
              </div>
              <div className="relative rounded-md border bg-muted/40">
                <CopyButton value={cli} label="Copy AWS CLI command" className="absolute top-1 right-1" />
                <pre className="max-h-40 overflow-auto p-3 pr-10 text-xs" data-testid="cli">
                  {cli}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
