// Turns a function's CloudWatch Logs events into one entry per invocation. The emulator writes the same lines AWS does:
// `START RequestId: …`, the function's own output (one event per line), `END RequestId: …` and a tab-separated
// `REPORT RequestId: …\tDuration: … ms\t…`; an unhandled error is a `[ERROR] <Type>: <message>` line plus a traceback.
export type LogEvent = { logStreamName?: string; timestamp?: number; message?: string };

export type Invocation = {
  /** Empty for output whose START line is outside the fetched window. */
  requestId: string;
  startedAt?: number;
  lines: string[];
  status: "ok" | "error" | "running";
  error?: string;
  durationMs?: number;
  billedMs?: number;
  memorySizeMb?: number;
  memoryUsedMb?: number;
};

const START = /^START RequestId: (\S+)/;
const END = /^END RequestId: (\S+)/;
const REPORT = /^REPORT RequestId: (\S+)/;
// What the runtime itself prints when the function fails (the function's own console.error or logging output is not a
// failure). Python: "[ERROR] ValueError: boom" (a space; logging.error() uses a tab). Node: "<time>\t<id>\tERROR\tInvoke
// Error \t{json with errorType and errorMessage}".
const PY_ERROR = /^\[ERROR\] (\S.*)/;
const NODE_ERROR = /^\S+\t\S+\tERROR\tInvoke Error\s*\t?(.*)/;

function failure(line: string): string | undefined {
  const py = PY_ERROR.exec(line);
  if (py) return py[1]!.trim();
  const node = NODE_ERROR.exec(line);
  if (!node) return undefined;
  try {
    const j = JSON.parse(node[1]!) as { errorType?: string; errorMessage?: string };
    if (j.errorMessage) return j.errorType ? `${j.errorType}: ${j.errorMessage}` : j.errorMessage;
  } catch {
    // not JSON: fall through
  }
  return "Invoke Error";
}

const num = (m: RegExpMatchArray | null) => (m ? Number(m[1]) : undefined);

export function groupInvocations(events: LogEvent[]): Invocation[] {
  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.timestamp ?? 0) - (b.e.timestamp ?? 0) || a.i - b.i)
    .map((x) => x.e);

  const byId = new Map<string, Invocation>();
  const current = new Map<string, Invocation>(); // per log stream
  const all: Invocation[] = [];
  const open = (stream: string, inv: Invocation) => {
    current.set(stream, inv);
    all.push(inv);
    return inv;
  };

  for (const ev of ordered) {
    const msg = (ev.message ?? "").replace(/\r?\n$/, "");
    const stream = ev.logStreamName ?? "";
    const start = START.exec(msg);
    if (start) {
      const inv = open(stream, { requestId: start[1]!, startedAt: ev.timestamp, lines: [], status: "running" });
      byId.set(inv.requestId, inv);
      continue;
    }
    const report = REPORT.exec(msg);
    if (report) {
      const inv = byId.get(report[1]!);
      if (inv) {
        inv.durationMs = num(/Duration: ([\d.]+) ms/.exec(msg));
        inv.billedMs = num(/Billed Duration: (\d+) ms/.exec(msg));
        inv.memorySizeMb = num(/Memory Size: (\d+) MB/.exec(msg));
        inv.memoryUsedMb = num(/Max Memory Used: (\d+) MB/.exec(msg));
        inv.status = inv.error !== undefined ? "error" : "ok";
      }
      continue;
    }
    if (END.test(msg)) continue;
    const inv = current.get(stream) ?? open(stream, { requestId: "", lines: [], status: "running" });
    inv.lines.push(msg);
    const err = failure(msg);
    if (err !== undefined && inv.error === undefined) inv.error = err;
  }
  for (const inv of all) if (inv.status === "running" && inv.error !== undefined) inv.status = "error";
  return all.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
