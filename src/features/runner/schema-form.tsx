"use client";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Field, FieldDef } from "@/lib/schema"; // type-only: the converter itself stays on the server

type Obj = Record<string, unknown>;
const isEmpty = (v: unknown) =>
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 0 &&
    !("$base64" in (v as Obj)));

// Removes unset members so the request only carries what the user filled in.
export function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune).filter((x) => x !== undefined);
  if (v !== null && typeof v === "object" && !("$base64" in (v as Obj))) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) {
      const p = prune(x);
      if (!isEmpty(p)) out[k] = p;
    }
    return out;
  }
  return v;
}

// The form keeps a draft (it must hold half-filled rows such as a new empty map entry) and reports the pruned
// JSON upward. When the JSON changes from elsewhere (the JSON tab), the draft is replaced by it.
export function SchemaForm({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState<unknown>(value);
  const last = useRef(JSON.stringify(prune(value)));
  useEffect(() => {
    const external = JSON.stringify(prune(value));
    if (external !== last.current) {
      last.current = external;
      setDraft(value);
    }
  }, [value]);
  const change = (v: unknown) => {
    setDraft(v);
    const out = prune(v) ?? {};
    last.current = JSON.stringify(out);
    onChange(out);
  };
  return (
    <div className="grid gap-3" data-testid="schema-form">
      <FieldInput field={field} value={draft} onChange={change} top />
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  top,
  label,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  top?: boolean;
  label?: string;
}) {
  switch (field.kind) {
    case "string":
    case "timestamp":
      return (
        <Input
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          placeholder={field.kind === "timestamp" ? "2026-01-01T00:00:00Z" : undefined}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          aria-label={label}
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "boolean":
      return (
        <Select
          aria-label={label}
          className="w-32"
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
        >
          <option value="">unset</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      );
    case "blob":
      return <BlobInput label={label} streaming={field.streaming} value={value} onChange={onChange} />;
    case "document":
      return <DocumentInput value={value} onChange={onChange} />;
    case "list": {
      const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <div className="grid gap-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border p-2">
              <div className="min-w-0 flex-1">
                <FieldInput
                  label={`${label ?? "Item"} ${i + 1}`}
                  field={field.item}
                  value={it}
                  onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
                />
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() =>
              onChange([...items, field.item.kind === "struct" || field.item.kind === "document" ? {} : undefined])
            }
          >
            <Plus /> Add item
          </Button>
        </div>
      );
    }
    case "map": {
      const entries = value !== null && typeof value === "object" ? Object.entries(value as Obj) : [];
      return (
        <div className="grid gap-2">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border p-2">
              <Input
                className="w-40 shrink-0"
                placeholder="key"
                aria-label={`Key ${i + 1}`}
                value={k}
                onChange={(e) =>
                  onChange(Object.fromEntries(entries.map(([kk, vv], j) => [j === i ? e.target.value : kk, vv])))
                }
              />
              <div className="min-w-0 flex-1">
                <FieldInput
                  label={`${label ?? "Value"} ${i + 1}`}
                  field={field.value}
                  value={v}
                  onChange={(nv) => onChange(Object.fromEntries(entries.map(([kk, vv], j) => [kk, j === i ? nv : vv])))}
                />
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove entry ${i + 1}`}
                onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() =>
              onChange({ ...Object.fromEntries(entries), "": field.value.kind === "struct" ? {} : undefined })
            }
          >
            <Plus /> Add entry
          </Button>
        </div>
      );
    }
    case "struct":
      return <StructInput fields={field.fields} value={(value ?? {}) as Obj} onChange={onChange} top={top} />;
  }
}

function StructInput({
  fields,
  value,
  onChange,
  top,
}: {
  fields: FieldDef[];
  value: Obj;
  onChange: (v: unknown) => void;
  top?: boolean;
}) {
  const required = fields.filter((f) => f.required);
  const optional = fields.filter((f) => !f.required);
  const set = (name: string, v: unknown) => onChange({ ...value, [name]: v });
  const row = (f: FieldDef) => (
    <div key={f.name} className="grid gap-1">
      <label className="text-sm font-medium">
        {f.name}
        {f.required && (
          <span className="ml-0.5 text-destructive" title="required">
            *
          </span>
        )}
      </label>
      <FieldInput label={f.name} field={f.field} value={value[f.name]} onChange={(v) => set(f.name, v)} />
    </div>
  );
  const anyOptionalSet = optional.some((f) => !isEmpty(value[f.name]));
  return (
    <div className={top ? "grid gap-3" : "grid gap-3 rounded-md border bg-muted/20 p-3"}>
      {required.map(row)}
      {optional.length > 0 && (
        <details open={anyOptionalSet} className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Optional fields ({optional.length})
          </summary>
          <div className="mt-3 grid gap-3">{optional.map(row)}</div>
        </details>
      )}
      {fields.length === 0 && <p className="text-sm text-muted-foreground">This operation takes no input.</p>}
    </div>
  );
}

function BlobInput({
  streaming,
  value,
  onChange,
  label,
}: {
  streaming: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
  label?: string;
}) {
  const isB64 = value !== null && typeof value === "object" && "$base64" in (value as Obj);
  const text = isB64 ? String((value as Obj).$base64) : typeof value === "string" ? value : "";
  return (
    <div className="grid gap-1.5">
      <Textarea
        aria-label={label}
        className="min-h-16 text-xs"
        value={text}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : isB64 ? { $base64: e.target.value } : e.target.value)
        }
      />
      {!streaming && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={isB64}
            onCheckedChange={(on) => onChange(text === "" ? undefined : on ? { $base64: text } : text)}
            aria-label="Base64"
          />{" "}
          Base64-encoded
        </label>
      )}
    </div>
  );
}

// Free-form JSON for shapes the form can't model; keeps its own text so half-typed JSON isn't lost.
function DocumentInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  return (
    <div className="grid gap-1">
      <CodeEditor
        value={text}
        height="100px"
        onChange={(t) => {
          setText(t);
          if (t.trim() === "") {
            setError("");
            return onChange(undefined);
          }
          try {
            onChange(JSON.parse(t));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
