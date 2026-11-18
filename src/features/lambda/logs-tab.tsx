"use client";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";

import { CopyButton, EmptyState, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { callOp, OpError } from "@/lib/aws-client";
import { timeAgo } from "@/lib/utils";

import { formatJsonLine, groupInvocations, type Invocation, type LogEvent } from "./logs";

const WINDOWS = [
  { label: "Last 15 minutes", ms: 15 * 60_000 },
  { label: "Last hour", ms: 60 * 60_000 },
  { label: "Last 24 hours", ms: 24 * 60 * 60_000 },
];
const PAGE = 1000;
const MAX_PAGES = 5; // sequential: the emulator drops connections under bursts
const MAX_LINES = 200;

type Page = { events?: LogEvent[]; nextToken?: string };

// Every run of a function, whoever started it (this console, the CLI, an SDK, an SNS subscription): the emulator
// writes them all to the function's CloudWatch log group.
export function LambdaLogs({ fn }: { fn: string }) {
  const { tid, region } = useTarget();
  const group = `/aws/lambda/${fn}`;
  const [windowMs, setWindowMs] = useState(WINDOWS[1]!.ms);
  const [auto, setAuto] = useState(false);
  const [pretty, setPretty] = useState(true);

  const logs = useQuery({
    queryKey: [tid, "lambda", "logs", fn, region, windowMs],
    queryFn: async (): Promise<{ runs: Invocation[]; truncated: boolean; missing: boolean }> => {
      const events: LogEvent[] = [];
      // One start time for every page: a token is only valid with the request that produced it.
      const startTime = Date.now() - windowMs;
      let nextToken: string | undefined;
      let pages = 0;
      try {
        do {
          const page: Page = await callOp<Page>(
            tid,
            "logs",
            "FilterLogEvents",
            { logGroupName: group, startTime, limit: PAGE, nextToken },
            region,
          );
          events.push(...(page.events ?? []));
          // The emulator also returns a token after the last events (like DynamoDB with filters): an empty page ends it.
          nextToken = page.events?.length ? page.nextToken : undefined;
          pages++;
        } while (nextToken && pages < MAX_PAGES);
      } catch (e) {
        // A function that has never run has no log group yet.
        if (e instanceof OpError && e.awsName === "ResourceNotFoundException")
          return { runs: [], truncated: false, missing: true };
        throw e;
      }
      return { runs: groupInvocations(events), truncated: !!nextToken, missing: false };
    },
    refetchInterval: auto ? 4000 : false,
  });

  return (
    <div data-testid="lambda-logs">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          className="w-44"
          aria-label="Time window"
          value={String(windowMs)}
          onChange={(e) => setWindowMs(Number(e.target.value))}
        >
          {WINDOWS.map((w) => (
            <option key={w.ms} value={w.ms}>
              {w.label}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="icon" aria-label="Refresh logs" onClick={() => logs.refetch()}>
          {logs.isFetching ? <Spinner /> : <RefreshCw />}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto-refresh logs" /> Auto-refresh
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={pretty} onCheckedChange={setPretty} aria-label="Format JSON in logs" /> Format JSON
        </label>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <code>{group}</code>
          <CopyButton value={group} label="Copy log group name" />
        </span>
      </div>

      {logs.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : logs.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {logs.error.message}
        </p>
      ) : logs.data!.runs.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={logs.data!.missing ? "No runs yet" : "No runs in this time window"}
          description="Invoke the function, or publish to a topic or queue it is subscribed to. Logs can lag a few seconds."
        />
      ) : (
        <>
          <ul className="grid gap-2">
            {logs.data!.runs.map((r, i) => (
              <li key={`${r.requestId}-${i}`}>
                <RunRow run={r} pretty={pretty} />
              </li>
            ))}
          </ul>
          {logs.data!.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {PAGE * MAX_PAGES} log events of this window; narrow the time window to see the rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RunRow({ run, pretty }: { run: Invocation; pretty: boolean }) {
  const [all, setAll] = useState(false);
  const lines = all ? run.lines : run.lines.slice(0, MAX_LINES);
  const shown = pretty ? lines.map(formatJsonLine) : lines;
  return (
    <details className="rounded-md border bg-card" data-testid="lambda-run">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm">
        <Badge variant={run.status === "ok" ? "success" : run.status === "error" ? "destructive" : "warning"}>
          {run.status === "ok" ? "ok" : run.status}
        </Badge>
        <span className="text-muted-foreground">
          {run.startedAt ? `${new Date(run.startedAt).toLocaleTimeString()} · ${timeAgo(new Date(run.startedAt))}` : ""}
        </span>
        <code className="text-xs">{run.requestId || "earlier run"}</code>
        {run.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">
            {run.durationMs} ms
            {run.memoryUsedMb !== undefined && ` · ${run.memoryUsedMb}/${run.memorySizeMb} MB`}
          </span>
        )}
        {run.error && <span className="min-w-0 truncate text-xs text-destructive">{run.error}</span>}
      </summary>
      <div className="border-t px-3 py-2">
        {run.lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No output.</p>
        ) : (
          <pre className="max-h-96 overflow-auto text-xs whitespace-pre-wrap">{shown.join("\n")}</pre>
        )}
        {!all && run.lines.length > MAX_LINES && (
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Show all {run.lines.length} lines
          </Button>
        )}
      </div>
    </details>
  );
}
