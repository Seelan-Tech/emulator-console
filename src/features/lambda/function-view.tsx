"use client";
import { Play, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { CopyButton, JsonViewer, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutateOp, useOp } from "@/lib/aws-client";
import { storage } from "@/lib/storage";

import type { FnConfig } from "./functions";
import { decodeLog, handlerFile, isReady, RUNTIMES } from "./runtimes";
import { fileToBase64, makeZip, toBase64 } from "./zip";

type InvokeOut = { StatusCode?: number; FunctionError?: string; Payload?: string; LogResult?: string };
type SavedEvent = { name: string; payload: string };

export function LambdaFunctionView({ fn }: { fn: string }) {
  const { tid } = useTarget();
  const cfg = useOp<FnConfig>(
    "lambda",
    "GetFunctionConfiguration",
    { FunctionName: fn },
    {
      // A new or updated function rejects invokes until Active: poll until it is.
      refetchInterval: (q) => (q.state.data && !isReady(q.state.data) ? 1000 : false),
    },
  );
  const c = cfg.data;
  const ready = isReady(c);
  const rt = c?.Runtime ? RUNTIMES[c.Runtime] : undefined;

  const invoke = useMutateOp<InvokeOut>("lambda", "Invoke", { invalidate: [] });
  const updateCode = useMutateOp("lambda", "UpdateFunctionCode");
  const updateConfig = useMutateOp("lambda", "UpdateFunctionConfiguration");

  const [payload, setPayload] = useState("{}");
  const [result, setResult] = useState<{ out: InvokeOut; ms: number } | null>(null);
  const [saved, setSaved] = useState<SavedEvent[]>([]);
  const eventsKey = `lambda-events:${tid}:${fn}`;
  useEffect(() => {
    setSaved(storage.getJson<SavedEvent[]>(eventsKey, []));
  }, [eventsKey]);
  const persist = (next: SavedEvent[]) => {
    setSaved(next);
    storage.setJson(eventsKey, next);
  };

  const [code, setCode] = useState<string | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [memory, setMemory] = useState<string>("");
  const [timeout, setTimeoutS] = useState<string>("");
  const [env, setEnv] = useState<string | null>(null);

  async function run() {
    try {
      JSON.parse(payload || "{}");
    } catch (e) {
      return toast.error(`Payload is not valid JSON: ${(e as Error).message}`);
    }
    const started = performance.now();
    await invoke.mutateAsync({ FunctionName: fn, Payload: payload || "{}", LogType: "Tail" }).then(
      (out) => setResult({ out, ms: Math.round(performance.now() - started) }),
      () => {},
    );
  }

  async function saveCode() {
    const ZipFile = {
      $base64: zip
        ? await fileToBase64(zip)
        : toBase64(makeZip(handlerFile(c!.Runtime!, c!.Handler!), code ?? rt!.code)),
    };
    await updateCode.mutateAsync({ FunctionName: fn, ZipFile }).then(
      () => {
        toast.success("Code updated");
        setZip(null);
      },
      () => {},
    );
  }

  async function saveConfig() {
    let Variables: Record<string, string> | undefined;
    if (env !== null) {
      try {
        Variables = JSON.parse(env) as Record<string, string>;
      } catch (e) {
        return toast.error(`Environment is not valid JSON: ${(e as Error).message}`);
      }
    }
    await updateConfig
      .mutateAsync({
        FunctionName: fn,
        MemorySize: Number(memory || c!.MemorySize),
        Timeout: Number(timeout || c!.Timeout),
        ...(Variables ? { Environment: { Variables } } : {}),
      })
      .then(
        () => toast.success("Configuration updated"),
        () => {},
      );
  }

  const parsedResponse = (() => {
    try {
      return JSON.stringify(JSON.parse(result?.out.Payload ?? ""), null, 2);
    } catch {
      return result?.out.Payload ?? "";
    }
  })();

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={fn}
        description={
          c ? (
            <span className="flex flex-wrap items-center gap-2">
              {c.Runtime} · <code className="text-xs">{c.Handler}</code> · {c.MemorySize} MB · {c.Timeout}s
              {c.FunctionArn && <CopyButton value={c.FunctionArn} label="Copy ARN" />}
            </span>
          ) : undefined
        }
        actions={
          <Badge variant={ready ? "success" : "warning"} data-testid="fn-state">
            {c ? (ready ? "Active" : (c.State ?? "Pending")) : "…"}
          </Badge>
        }
      >
        <Link
          href={`/t/${tid}/lambda`}
          className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← Functions
        </Link>
      </PageHeader>

      {!c ? (
        <Skeleton className="h-40" />
      ) : (
        <Tabs defaultValue="invoke">
          <TabsList>
            <TabsTrigger value="invoke">Invoke</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="invoke">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Label>Test event</Label>
              <Select
                className="w-48"
                aria-label="Saved events"
                value=""
                onChange={(e) => {
                  const ev = saved.find((s) => s.name === e.target.value);
                  if (ev) setPayload(ev.payload);
                }}
              >
                <option value="">{saved.length ? "Load saved…" : "No saved events"}</option>
                {saved.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const name = prompt("Name for this test event");
                  if (name?.trim())
                    persist([...saved.filter((s) => s.name !== name.trim()), { name: name.trim(), payload }]);
                }}
              >
                <Save /> Save event
              </Button>
              {saved.length > 0 && (
                <Button size="icon-sm" variant="ghost" aria-label="Clear saved events" onClick={() => persist([])}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <CodeEditor value={payload} onChange={setPayload} height="160px" />
            <div className="my-3 flex items-center gap-3">
              <Button onClick={run} disabled={!ready || invoke.isPending}>
                {invoke.isPending ? <Spinner /> : <Play />} Invoke
              </Button>
              {!ready && (
                <span className="text-xs text-muted-foreground">Waiting for the function to become active…</span>
              )}
              {result && <span className="text-xs text-muted-foreground">{result.ms} ms</span>}
            </div>
            {result && (
              <div className="grid gap-3" data-testid="invoke-result">
                <div className="flex items-center gap-2">
                  <Badge variant={result.out.FunctionError ? "destructive" : "success"}>
                    HTTP {result.out.StatusCode}
                  </Badge>
                  {result.out.FunctionError && <Badge variant="destructive">{result.out.FunctionError}</Badge>}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Response</div>
                  <JsonViewer value={parsedResponse} />
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Log</div>
                  <pre
                    className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs"
                    data-testid="invoke-log"
                  >
                    {decodeLog(result.out.LogResult) || "(no log output)"}
                  </pre>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="code">
            <p className="mb-2 text-sm text-muted-foreground">
              The emulator can&apos;t return a function&apos;s current code, so this starts from the runtime template.
              Saving replaces the code.
            </p>
            {zip ? (
              <div className="mb-3 flex items-center gap-2 rounded-md border p-3 text-sm">
                Using <b>{zip.name}</b>{" "}
                <Button size="sm" variant="ghost" onClick={() => setZip(null)}>
                  Use inline code instead
                </Button>
              </div>
            ) : (
              <div className="mb-3">
                <Label className="mb-1 block">{handlerFile(c.Runtime!, c.Handler!)}</Label>
                <CodeEditor value={code ?? rt?.code ?? ""} onChange={setCode} language={rt?.language} height="300px" />
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={saveCode} disabled={updateCode.isPending}>
                {updateCode.isPending && <Spinner />} Update code
              </Button>
              <input
                ref={zipInput}
                type="file"
                accept=".zip"
                hidden
                onChange={(e) => setZip(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" onClick={() => zipInput.current?.click()}>
                Upload a .zip
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="config">
            <Card>
              <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="mem">Memory (MB)</Label>
                  <Input
                    id="mem"
                    type="number"
                    value={memory || c.MemorySize || ""}
                    onChange={(e) => setMemory(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="to">Timeout (seconds)</Label>
                  <Input
                    id="to"
                    type="number"
                    value={timeout || c.Timeout || ""}
                    onChange={(e) => setTimeoutS(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Environment variables (JSON)</Label>
                  <CodeEditor
                    value={env ?? JSON.stringify(c.Environment?.Variables ?? {}, null, 2)}
                    onChange={setEnv}
                    height="120px"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button onClick={saveConfig} disabled={updateConfig.isPending}>
                    {updateConfig.isPending && <Spinner />} Save configuration
                  </Button>
                </div>
              </CardContent>
            </Card>
            <div className="mt-4">
              <JsonViewer value={c} />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
