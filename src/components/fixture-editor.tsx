"use client";
import { CheckCircle2, Play, Save, Trash2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, Spinner } from "@/components/common";
import { CopyCliButton } from "@/components/copy-cli-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { FixtureRunView, StepResult } from "@/lib/api-types";
import { cliScript } from "@/lib/cli-command";
import { api } from "@/lib/client";

export function FixtureEditor(props: {
  fixture: { id: string; name: string; description: string; steps: unknown[] };
  targets: { id: string; name: string }[];
  runs: FixtureRunView[];
}) {
  const { fixture, targets } = props;
  const router = useRouter();
  const [name, setName] = useState(fixture.name);
  const [description, setDescription] = useState(fixture.description);
  const [steps, setSteps] = useState(JSON.stringify(fixture.steps, null, 2));
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [continueOnError, setContinue] = useState(false);
  const [result, setResult] = useState<FixtureRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(steps);
    } catch (e) {
      toast.error(`Steps are not valid JSON: ${(e as Error).message}`);
      return false;
    }
    try {
      await api(`/api/fixtures/${fixture.id}`, "PUT", { name, description, steps: parsed });
      toast.success("Fixture saved");
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function run() {
    if (!(await save())) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<FixtureRunView>(`/api/fixtures/${fixture.id}/run`, "POST", { targetId, continueOnError });
      setResult(r);
      if (r.status === "succeeded") toast.success("Fixture replayed");
      else toast.error("Fixture run failed");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  const results = (rs: StepResult[]) => (
    <Table>
      <THead>
        <TR>
          <TH>#</TH>
          <TH>Call</TH>
          <TH>Result</TH>
          <TH>ms</TH>
        </TR>
      </THead>
      <TBody>
        {rs.map((r) => (
          <TR key={r.index}>
            <TD>{r.index + 1}</TD>
            <TD className="font-mono text-xs">
              {r.service}.{r.operation}
            </TD>
            <TD>
              {r.ok ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-4" />
                  ok{r.attempts > 1 ? ` (${r.attempts} attempts)` : ""}
                  {r.captured?.length ? (
                    <span className="text-muted-foreground">kept {r.captured.join(", ")}</span>
                  ) : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <XCircle className="size-4" />
                  {r.error}
                </span>
              )}
            </TD>
            <TD className="text-muted-foreground">{r.ms}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <Input
          value={description}
          placeholder="Description"
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
          <p className="text-xs text-muted-foreground">
            A JSON array of calls, e.g.{" "}
            <code>{`{"service":"s3","operation":"CreateBucket","input":{"Bucket":"x"}}`}</code>. Optional per step:{" "}
            <code>delayAfterMs</code>, <code>retries</code>, <code>retryDelayMs</code>, <code>region</code>. Easier:
            record steps from a target.
          </p>
        </CardHeader>
        <CardContent>
          <CodeEditor value={steps} onChange={setSteps} height="320px" />
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={save}>
              <Save /> Save
            </Button>
            <CopyCliButton
              label="Copy as AWS CLI script"
              command={() => {
                const parsed: unknown = JSON.parse(steps);
                return Array.isArray(parsed) ? cliScript(parsed as Parameters<typeof cliScript>[0]) : null;
              }}
            />
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              <Trash2 className="text-destructive" /> Delete fixture
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Replay on a target</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {targets.length ? (
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-56"
                aria-label="Target"
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={continueOnError} onCheckedChange={(v) => setContinue(v === true)} /> Continue after a
                failed step
              </label>
              <Button disabled={busy} onClick={run}>
                {busy ? <Spinner /> : <Play />} {busy ? "Running…" : "Save & run"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Add a target first.</p>
          )}
          {result && (
            <div className="grid gap-2">
              <Badge variant={result.status === "succeeded" ? "success" : "destructive"} className="justify-self-start">
                Run {result.status}
              </Badge>
              {results(result.results)}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        {props.runs.length ? (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Target</TH>
                <TH>Status</TH>
                <TH>Steps</TH>
              </TR>
            </THead>
            <TBody>
              {props.runs.map((r) => {
                const failed = r.results.find((x) => !x.ok);
                return (
                  <TR key={r.id}>
                    <TD>{new Date(r.started_at).toLocaleString()}</TD>
                    <TD>{r.target_name ?? "(deleted)"}</TD>
                    <TD>
                      <Badge
                        variant={
                          r.status === "succeeded" ? "success" : r.status === "failed" ? "destructive" : "default"
                        }
                      >
                        {r.status}
                      </Badge>
                      {r.trigger === "restart" && (
                        <Badge variant="outline" className="ml-1">
                          after restart
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      {r.results.filter((x) => x.ok).length}/{r.results.length}
                      {failed ? <span className="text-destructive"> · {failed.error}</span> : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">Not run yet.</p>
        )}
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete fixture “${fixture.name}”?`}
        description="Its run history is deleted too."
        typeToConfirm={fixture.name}
        onConfirm={async () => {
          await api(`/api/fixtures/${fixture.id}`, "DELETE");
          router.push("/fixtures");
          router.refresh();
        }}
      />
    </div>
  );
}
