"use client";
import { AlertTriangle, CheckCircle2, ListChecks, Play, RotateCw, Save, Trash2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AssertionAdder } from "@/components/assertion-adder";
import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, Spinner } from "@/components/common";
import { CopyCliButton } from "@/components/copy-cli-button";
import { ExportButton } from "@/components/fixture-share";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { FixtureRunView, StepResult } from "@/lib/api-types";
import { cliScript } from "@/lib/cli-command";
import { api } from "@/lib/client";
import type { Problem } from "@/lib/fixture-check";
import { fileSlug, fixtureFile } from "@/lib/fixture-file";
import { assertionSummary } from "@/lib/fixture-summary";
import { resumePlan } from "@/lib/fixture-vars";
import type { Step } from "@/lib/schemas";

// "3 of 4 assertions held": a run's checks at a glance, nothing when it has none.
function AssertionCount({ results, inline = false }: { results: StepResult[]; inline?: boolean }) {
  const { total, held } = assertionSummary(results);
  if (!total) return null;
  const text = `${held} of ${total} ${total === 1 ? "assertion" : "assertions"} held`;
  return (
    <span className={`text-xs ${held === total ? "text-success" : "text-destructive"} ${inline ? "ml-1" : ""}`}>
      {inline ? `· ${text}` : text}
    </span>
  );
}

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
  const [problems, setProblems] = useState<Problem[] | null>(null);
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

  async function run(fromStep?: number) {
    if (!(await save())) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<FixtureRunView>(`/api/fixtures/${fixture.id}/run`, "POST", {
        targetId,
        continueOnError,
        fromStep,
      });
      setResult(r);
      if (r.status === "succeeded") toast.success("Fixture replayed");
      else toast.error("Fixture run failed");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  async function check() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(steps);
    } catch (e) {
      return toast.error(`Steps are not valid JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) return toast.error("Steps must be a JSON array");
    try {
      setProblems((await api<{ problems: Problem[] }>("/api/fixtures/check", "POST", { steps: parsed })).problems);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function addStep(step: Step) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(steps);
    } catch (e) {
      return toast.error(`Steps are not valid JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) return toast.error("Steps must be a JSON array");
    setSteps(JSON.stringify([...(parsed as unknown[]), step], null, 2));
    toast.success("Assertion added at the end of the steps. Save to keep it.");
  }

  // What resuming at a failed step would run: the steps from there, plus earlier ones that keep a value they use.
  function resumeNote(from: number): string | undefined {
    try {
      const parsed = JSON.parse(steps) as { input?: unknown; capture?: Record<string, string> }[];
      const again = resumePlan(parsed, from).filter((i) => i < from);
      return again.length
        ? `Also runs step ${again.map((i) => i + 1).join(", ")} again: it keeps a value a later step uses.`
        : undefined;
    } catch {
      return undefined;
    }
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
                  {r.checks ? (
                    <span className="text-muted-foreground">
                      {r.checks} {r.checks === 1 ? "check holds" : "checks hold"}
                    </span>
                  ) : null}
                  {r.captured?.length ? (
                    <span className="text-muted-foreground">kept {r.captured.join(", ")}</span>
                  ) : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <XCircle className="size-4" />
                  {r.error}
                  {r.checks ? (
                    <span className="text-muted-foreground">({r.checks === 1 ? "1 check" : `${r.checks} checks`})</span>
                  ) : null}
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
            <code>delayAfterMs</code>, <code>retries</code>, <code>retryDelayMs</code>, <code>region</code>,{" "}
            <code>capture</code>, <code>expect</code> (an assertion). Easier: record steps from a target.
          </p>
        </CardHeader>
        <CardContent>
          <CodeEditor value={steps} onChange={setSteps} height="320px" />
          <AssertionAdder onAdd={addStep} />
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={save}>
              <Save /> Save
            </Button>
            <Button variant="outline" onClick={check}>
              <ListChecks /> Check
            </Button>
            <CopyCliButton
              label="Copy as AWS CLI script"
              command={() => {
                const parsed: unknown = JSON.parse(steps);
                return Array.isArray(parsed) ? cliScript(parsed as Parameters<typeof cliScript>[0]) : null;
              }}
            />
            <ExportButton
              label="Export"
              prepare={async () => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(steps);
                } catch (e) {
                  throw new Error(`Steps are not valid JSON: ${(e as Error).message}`);
                }
                if (!Array.isArray(parsed)) throw new Error("Steps must be a JSON array");
                return {
                  filename: `${fileSlug(name)}.fixture.json`,
                  text: fixtureFile({ name, description, steps: parsed as unknown[] }),
                };
              }}
            />
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              <Trash2 className="text-destructive" /> Delete fixture
            </Button>
          </div>
          {problems && (
            <div className="mt-3 grid gap-1 text-sm" data-testid="check-result">
              {problems.length ? (
                problems.map((p, i) => (
                  <p
                    key={i}
                    className={`flex items-start gap-1 ${p.level === "error" ? "text-destructive" : "text-warning"}`}
                  >
                    {p.level === "error" ? (
                      <XCircle className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span>
                      <b>Step {p.step + 1}</b> {p.message}
                    </span>
                  </p>
                ))
              ) : (
                <p className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-4" /> No problems found. Nothing was sent to the emulator.
                </p>
              )}
            </div>
          )}
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
              <Button disabled={busy} onClick={() => run()}>
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
              <AssertionCount results={result.results} />
              <div data-testid="fixture-results">{results(result.results)}</div>
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
                      <AssertionCount results={r.results} inline />
                      {failed ? <span className="text-destructive"> · {failed.error}</span> : null}
                      {failed && targets.length ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-1"
                          disabled={busy}
                          title={resumeNote(failed.index)}
                          onClick={() => run(failed.index)}
                        >
                          <RotateCw /> Resume from step {failed.index + 1}
                        </Button>
                      ) : null}
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
