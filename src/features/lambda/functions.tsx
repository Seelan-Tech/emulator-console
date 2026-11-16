"use client";
import { useQuery } from "@tanstack/react-query";
import { FunctionSquare, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { CodeEditor } from "@/components/code-editor";
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

import { DEFAULT_ROLE, DEFAULT_RUNTIME, handlerFile, isReady, runtimeInfo, RUNTIMES } from "./runtimes";
import { fileToBase64, makeZip, toBase64 } from "./zip";

export type FnConfig = {
  FunctionName: string;
  Runtime?: string;
  Handler?: string;
  MemorySize?: number;
  Timeout?: number;
  State?: string;
  LastUpdateStatus?: string;
  FunctionArn?: string;
  Role?: string;
  Environment?: { Variables?: Record<string, string> };
};

export function LambdaFunctions() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/lambda`;
  // ListFunctions omits State, so read each configuration (sequentially, to spare the emulator).
  const fns = useQuery({
    queryKey: [tid, "lambda", "functions", region],
    queryFn: async () => {
      const { Functions = [] } = await callOp<{ Functions?: { FunctionName: string }[] }>(
        tid,
        "lambda",
        "ListFunctions",
        {},
        region,
      );
      const out: FnConfig[] = [];
      for (const f of Functions)
        out.push(
          await callOp<FnConfig>(tid, "lambda", "GetFunctionConfiguration", { FunctionName: f.FunctionName }, region),
        );
      return out;
    },
    refetchInterval: (q) => (q.state.data?.some((f) => !isReady(f)) ? 1500 : false),
  });
  const create = useMutateOp("lambda", "CreateFunction");
  const del = useMutateOp("lambda", "DeleteFunction");

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState("python3.12");
  const [handler, setHandler] = useState("index.handler");
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [code, setCode] = useState(runtimeInfo(DEFAULT_RUNTIME).code);
  const [zip, setZip] = useState<File | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  function pickRuntime(r: string) {
    // Swap the starter code only if the user hasn't changed it.
    if (code === runtimeInfo(runtime).code) setCode(runtimeInfo(r).code);
    setRuntime(r);
    setHandler(runtimeInfo(r).handler);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const b64 = zip ? await fileToBase64(zip) : toBase64(makeZip(handlerFile(runtime, handler), code));
    await create
      .mutateAsync({
        FunctionName: name,
        Runtime: runtime,
        Handler: handler,
        Role: role,
        Code: { ZipFile: { $base64: b64 } },
      })
      .then(
        () => {
          // Back to a clean form: a leftover runtime from the last function would silently apply to the next one.
          setCreating(false);
          setName("");
          setZip(null);
          setRuntime("python3.12");
          setHandler(runtimeInfo(DEFAULT_RUNTIME).handler);
          setCode(runtimeInfo(DEFAULT_RUNTIME).code);
          setRole(DEFAULT_ROLE);
        },
        () => {},
      );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="Lambda functions"
        description="Functions run real code (Python and Node.js)."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create function
          </Button>
        }
      />
      {fns.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : fns.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {fns.error.message}
        </p>
      ) : (fns.data ?? []).length === 0 ? (
        <EmptyState
          icon={<FunctionSquare />}
          title="No functions"
          description="Create a function from a starter template or a zip file."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create function
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Runtime</TH>
              <TH>Handler</TH>
              <TH>Memory</TH>
              <TH>Timeout</TH>
              <TH>State</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {fns.data!.map((f) => (
              <TR key={f.FunctionName}>
                <TD>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`${base}/${encodeURIComponent(f.FunctionName)}`}
                  >
                    {f.FunctionName}
                  </Link>
                </TD>
                <TD>{f.Runtime}</TD>
                <TD className="font-mono text-xs">{f.Handler}</TD>
                <TD className="text-muted-foreground">{f.MemorySize} MB</TD>
                <TD className="text-muted-foreground">{f.Timeout} s</TD>
                <TD>
                  <Badge variant={isReady(f) ? "success" : "warning"}>
                    {isReady(f) ? "Active" : (f.State ?? "Pending")}
                  </Badge>
                </TD>
                <TD className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete function ${f.FunctionName}`}
                    onClick={() => setDeleting(f.FunctionName)}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create function</DialogTitle>
            <DialogDescription>Write the code inline, or upload a .zip.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="f-name">Function name</Label>
                <Input id="f-name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-rt">Runtime</Label>
                <Select id="f-rt" value={runtime} onChange={(e) => pickRuntime(e.target.value)}>
                  {Object.entries(RUNTIMES).map(([id, r]) => (
                    <option key={id} value={id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-h">Handler</Label>
                <Input id="f-h" value={handler} onChange={(e) => setHandler(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-role">Role ARN</Label>
                <Input id="f-role" value={role} onChange={(e) => setRole(e.target.value)} />
              </div>
            </div>
            {zip ? (
              <div className="flex items-center gap-2 rounded-md border p-3 text-sm">
                Using <b>{zip.name}</b>{" "}
                <Button type="button" size="sm" variant="ghost" onClick={() => setZip(null)}>
                  Use inline code instead
                </Button>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label>
                  Code <span className="text-muted-foreground">({handlerFile(runtime, handler)})</span>
                </Label>
                <CodeEditor value={code} onChange={setCode} language={runtimeInfo(runtime).language} height="220px" />
              </div>
            )}
            <div>
              <input
                ref={zipInput}
                type="file"
                accept=".zip"
                hidden
                data-testid="zip-input"
                onChange={(e) => setZip(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => zipInput.current?.click()}>
                Upload a .zip instead
              </Button>
            </div>
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
        title={`Delete function “${deleting}”?`}
        typeToConfirm={deleting ?? undefined}
        onConfirm={() => del.mutateAsync({ FunctionName: deleting! })}
      />
    </div>
  );
}
