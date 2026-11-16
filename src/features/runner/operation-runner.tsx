"use client";
import { useQuery } from "@tanstack/react-query";
import { History, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CodeEditor } from "@/components/code-editor";
import { JsonViewer, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { serviceMeta } from "@/features/services";
import { type OpError, useMutateOp } from "@/lib/aws-client";
import { api } from "@/lib/client";
import type { Field } from "@/lib/schema";
import { sessionStorageJson } from "@/lib/storage";

import { SchemaForm } from "./schema-form";

type Outcome = { ok: true; ms: number; output: unknown } | { ok: false; ms: number; error: OpError };
type Call = { svc: string; op: string; input: string; ok: boolean; at: number };

export function OperationRunner({ svc, op }: { svc: string; op: string }) {
  const { tid } = useTarget();
  const meta = serviceMeta(svc)!;
  const schema = useQuery({
    queryKey: ["schema", svc, op],
    queryFn: () => api<{ input: Field | null }>(`/api/schema/${svc}/${op}`),
    staleTime: Infinity,
  });
  const field = schema.data?.input ?? null;

  // Controlled: the schema arrives after first render, and the form tab should be the default once it does.
  const [tab, setTab] = useState<string | null>(null);
  const [text, setText] = useState("{}");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [history, setHistory] = useState<Call[]>([]);
  const historyKey = `runner-history:${tid}`;
  useEffect(() => {
    setHistory(sessionStorageJson.get<Call[]>(historyKey, []));
  }, [historyKey]);

  const run = useMutateOp(meta.id, op, { silentError: true });
  let parsed: unknown;
  let parseError = "";
  try {
    parsed = JSON.parse(text || "{}");
  } catch (e) {
    parseError = (e as Error).message;
  }
  const formValue = parseError || parsed === null || typeof parsed !== "object" ? {} : parsed;

  async function execute() {
    if (parseError) return;
    const started = performance.now();
    const record = (ok: boolean) => {
      const next = [{ svc, op, input: text, ok, at: Date.now() }, ...history].slice(0, 10);
      setHistory(next);
      sessionStorageJson.set(historyKey, next);
    };
    await run.mutateAsync(parsed as Record<string, unknown>).then(
      (output) => {
        setOutcome({ ok: true, ms: Math.round(performance.now() - started), output });
        record(true);
      },
      (error: OpError) => {
        setOutcome({ ok: false, ms: Math.round(performance.now() - started), error });
        record(false);
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={op}
        description={
          <span className="inline-flex items-center gap-2">
            {meta.label} <Badge variant="outline">{meta.id}</Badge>
          </span>
        }
      >
        <Link
          href={`/t/${tid}/s/${svc}`}
          className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← {meta.label} operations
        </Link>
      </PageHeader>

      <Tabs value={tab ?? (field ? "form" : "json")} onValueChange={setTab}>
        <TabsList>
          {field && <TabsTrigger value="form">Form</TabsTrigger>}
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        {field && (
          <TabsContent value="form">
            {parseError ? (
              <p className="text-sm text-warning">
                The JSON has a syntax error ({parseError}). Fix it in the JSON tab to use the form.
              </p>
            ) : (
              <SchemaForm field={field} value={formValue} onChange={(v) => setText(JSON.stringify(v, null, 2))} />
            )}
          </TabsContent>
        )}
        <TabsContent value="json">
          <CodeEditor value={text} onChange={setText} height="260px" />
          {parseError && <p className="mt-1 text-xs text-destructive">{parseError}</p>}
        </TabsContent>
      </Tabs>

      <div className="my-4 flex items-center gap-3">
        <Button onClick={execute} disabled={!!parseError || run.isPending}>
          {run.isPending ? <Spinner /> : <Play />} Run
        </Button>
        {outcome && <span className="text-xs text-muted-foreground">{outcome.ms} ms</span>}
      </div>

      {outcome && (
        <div data-testid="outcome" className="grid gap-2">
          {outcome.ok ? (
            <Badge variant="success" className="justify-self-start">
              Success
            </Badge>
          ) : (
            <Card className="border-destructive/40">
              <CardContent className="pt-4 text-sm">
                <div className="font-medium text-destructive">
                  {outcome.error.awsName ?? "Error"}
                  {outcome.error.status ? ` (${outcome.error.status})` : ""}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{outcome.error.message}</div>
              </CardContent>
            </Card>
          )}
          {outcome.ok && <JsonViewer value={outcome.output} />}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <History className="size-4" /> Recent calls
          </h2>
          <div className="grid gap-1">
            {history.map((h, i) => (
              <button
                key={i}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/50"
                onClick={() => {
                  if (h.svc === svc && h.op === op) setText(h.input);
                }}
                title={h.input}
              >
                <Badge variant={h.ok ? "success" : "destructive"}>{h.ok ? "ok" : "error"}</Badge>
                <span className="font-mono">
                  {h.svc}.{h.op}
                </span>
                <span className="ml-auto text-muted-foreground">{new Date(h.at).toLocaleTimeString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
