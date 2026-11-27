"use client";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FunctionSquare,
  GitFork,
  Globe,
  Inbox,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

import {
  buildGraph,
  filterFlows,
  type Flow,
  type GEdge,
  type GNode,
  isProblem,
  layout,
  NODE_H,
  NODE_W,
  type NodeKind,
  splitFlows,
} from "./graph";
import { loadFlow } from "./load";

const ICON: Record<NodeKind, typeof Bell> = {
  topic: Bell,
  queue: Inbox,
  function: FunctionSquare,
  bus: CalendarClock,
  other: Globe,
};
const KIND: Record<NodeKind, string> = {
  topic: "SNS topic",
  queue: "SQS queue",
  function: "Lambda function",
  bus: "Event bus",
  other: "Outside",
};

// How an edge is told apart: colour for the subscription's health (never colour alone: the label says it too).
type Look = { label: string; tone: string; dashed: boolean };
const HEALTH_LOOK: Record<string, Look> = {
  delivers: { label: "delivers", tone: "text-success", dashed: false },
  "needs-permission": { label: "needs permission", tone: "text-warning-text", dashed: true },
  missing: { label: "endpoint missing", tone: "text-destructive", dashed: true },
  pending: { label: "pending confirmation", tone: "text-muted-foreground", dashed: true },
  "no-delivery": { label: "will not deliver", tone: "text-muted-foreground", dashed: true },
  "not-checked": { label: "not checked", tone: "text-muted-foreground", dashed: false },
  unknown: { label: "unknown", tone: "text-muted-foreground", dashed: true },
};

export function edgeLook(e: Pick<GEdge, "kind" | "health" | "note" | "label" | "disabled">): Look {
  if (e.kind === "dead-letter") return { label: "dead letters", tone: "text-muted-foreground", dashed: true };
  if (e.kind === "event-source")
    return { label: e.note ? `triggers (${e.note})` : "triggers", tone: "text-foreground", dashed: false };
  const h = HEALTH_LOOK[e.health ?? "unknown"] ?? HEALTH_LOOK.unknown!;
  if (e.kind === "rule") {
    // a rule says its own name; a rule that is switched off is greyed, whatever its target would do
    const name = `${e.label ?? "rule"}${e.disabled ? " (disabled)" : ""}`;
    return {
      label: `${name}: ${h.label}`,
      tone: e.disabled ? "text-muted-foreground" : h.tone,
      dashed: e.disabled || h.dashed,
    };
  }
  return h;
}

// A long name keeps its start and its end: names in one place usually share a prefix, and the end tells them apart.
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.ceil((max - 1) / 2);
  return `${text.slice(0, max - 1 - tail)}…${text.slice(text.length - tail)}`;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// What the diagram writes on a line: a rule is just its name (the table and the tooltip say the rest), the rest are as is.
export function lineLabel(e: Pick<GEdge, "kind" | "health" | "note" | "label" | "disabled">): string {
  if (e.kind !== "rule") return edgeLook(e).label;
  return `${clip(e.label ?? "rule", 18)}${e.disabled ? " (off)" : ""}`;
}

// Up to this many groups are all open; beyond that only those with a problem are, the rest open on a click.
const OPEN_ALL_UP_TO = 6;

export function FlowView() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}`;
  const [progress, setProgress] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const flow = useQuery({
    queryKey: [tid, "flow", region],
    queryFn: () => loadFlow(tid, region, setProgress),
  });
  const graph = useMemo(() => (flow.data ? buildGraph({ base, ...flow.data.parts }) : null), [flow.data, base]);
  const flows = useMemo(() => (graph ? splitFlows(graph) : []), [graph]);
  const shown = useMemo(() => filterFlows(flows, { problemsOnly, query }), [flows, problemsOnly, query]);
  const byId = new Map(graph?.nodes.map((n) => [n.id, n]) ?? []);
  const connected = new Set(flows.flatMap((f) => f.graph.nodes.map((n) => n.id)));
  const q = query.trim().toLowerCase();
  const isolated = problemsOnly
    ? []
    : (graph?.nodes ?? []).filter((n) => !connected.has(n.id) && (!q || n.label.toLowerCase().includes(q)));
  const rows = shown.flatMap((f) => (problemsOnly ? f.graph.edges.filter(isProblem) : f.graph.edges));
  const problems = flows.reduce((n, f) => n + f.problems, 0);

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <PageHeader
        title="Message flow"
        description="Which topics deliver to which queues and functions, and what triggers what."
        actions={
          <Button variant="outline" onClick={() => void flow.refetch()} disabled={flow.isFetching}>
            {flow.isFetching ? <Spinner /> : <RotateCw />} Refresh
          </Button>
        }
      />
      {flow.isLoading ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground" role="status">
            {progress || "Reading resources"}
          </p>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : flow.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {flow.error.message}
        </p>
      ) : graph ? (
        <div className="grid gap-6">
          {flow.data!.warnings.map((w) => (
            <p key={w} className="text-sm text-warning-text" role="status">
              Could not read {w}
            </p>
          ))}
          {flows.length === 0 ? (
            <EmptyState
              icon={<GitFork />}
              title="Nothing is connected yet"
              description="Subscribe a queue or function to a topic, give a queue a dead-letter queue, or add a Lambda event source: the connections show up here."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  className="max-w-xs"
                  type="search"
                  aria-label="Search the flow"
                  placeholder="Find a queue, topic, function or rule"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={problemsOnly}
                    onChange={(e) => setProblemsOnly(e.target.checked)}
                    data-testid="flow-problems-only"
                  />
                  Only connections with a problem{problems ? ` (${problems})` : ""}
                </label>
                <span className="text-sm text-muted-foreground" role="status" data-testid="flow-count">
                  {shown.length === flows.length
                    ? `${flows.length} ${flows.length === 1 ? "flow" : "flows"}`
                    : `${shown.length} of ${flows.length} flows`}
                </span>
              </div>
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {problemsOnly && !q ? "No connection has a problem." : "No flow matches."}
                </p>
              ) : (
                shown.map((f) => (
                  <FlowCard
                    key={f.id}
                    flow={f}
                    problemsOnly={problemsOnly}
                    defaultOpen={flows.length <= OPEN_ALL_UP_TO || f.problems > 0 || q !== ""}
                  />
                ))
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="text-success">━ delivers</span>
                <span className="text-warning-text">╌ needs permission</span>
                <span className="text-destructive">╌ endpoint missing</span>
                <span>╌ dead letters / will not deliver / pending</span>
                <span className="text-foreground">━ triggers</span>
                <span>rule lines carry the rule&apos;s name, grey when it is disabled</span>
              </div>
            </>
          )}
          {isolated.length > 0 && (
            <section aria-label="Not connected">
              <h2 className="mb-2 text-sm font-semibold">Not connected ({isolated.length})</h2>
              <ul className="flex flex-wrap gap-2">
                {isolated.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href ?? "#"}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-accent"
                    >
                      {(() => {
                        const Icon = ICON[n.kind];
                        return <Icon className="size-4 text-muted-foreground" />;
                      })()}
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rows.length > 0 && (
            <section aria-label="Connections">
              <h2 className="mb-2 text-sm font-semibold">Connections ({rows.length})</h2>
              <Table data-testid="flow-table">
                <THead>
                  <TR>
                    <TH>From</TH>
                    <TH>To</TH>
                    <TH>What</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((e) => {
                    const look = edgeLook(e);
                    return (
                      <TR key={e.id}>
                        <TD>
                          <NodeLink node={byId.get(e.from)} />
                        </TD>
                        <TD>
                          <NodeLink node={byId.get(e.to)} />
                        </TD>
                        <TD className={look.tone}>
                          {e.href ? (
                            <Link className="underline-offset-2 hover:underline" href={e.href}>
                              {look.label}
                            </Link>
                          ) : (
                            look.label
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}

// One group of connected resources, drawn on its own. It can be folded away: only the groups with a problem are open
// when there are many.
function FlowCard({ flow, problemsOnly, defaultOpen }: { flow: Flow; problemsOnly: boolean; defaultOpen: boolean }) {
  // what the person chose wins; until then the default follows the search and the filter
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? defaultOpen;
  const bodyId = useId();
  const placed = useMemo(() => (open ? layout(flow.graph) : null), [open, flow.graph]);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="rounded-lg border bg-card" aria-label={`Flow: ${flow.title}`} data-testid="flow-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setChosen(!open)}
      >
        <Chevron className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">{flow.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {flow.graph.nodes.length} resources · {flow.graph.edges.length} connections
        </span>
        {flow.problems > 0 && (
          <span className="shrink-0 text-xs text-warning-text">
            {flow.problems} {flow.problems === 1 ? "problem" : "problems"}
          </span>
        )}
      </button>
      <div id={bodyId} hidden={!open} className="overflow-x-auto border-t p-2" data-testid="flow-diagram">
        {placed && <FlowDiagram placed={placed} dim={problemsOnly} />}
      </div>
    </section>
  );
}

function FlowDiagram({ placed, dim }: { placed: ReturnType<typeof layout>; dim: boolean }) {
  const arrow = `arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      width={placed.width}
      height={placed.height}
      viewBox={`0 0 ${placed.width} ${placed.height}`}
      role="group"
      aria-label="Message flow diagram. The same connections are listed in the table below."
    >
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {placed.edges.map((e) => {
        const look = edgeLook(e);
        return (
          <g key={e.id} className={look.tone} opacity={dim && !isProblem(e) ? 0.35 : 1}>
            <title>{look.label}</title>
            <path
              d={e.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeDasharray={look.dashed ? "6 4" : undefined}
              markerEnd={`url(#${arrow})`}
            />
          </g>
        );
      })}
      {placed.nodes.map((n) => (
        <NodeBox key={n.id} node={n} x={n.x} y={n.y} />
      ))}
      {placed.edges.map((e) => (
        <text
          key={e.id}
          x={e.mid.x}
          y={e.mid.y - 5}
          textAnchor="middle"
          className={`${edgeLook(e).tone} fill-current text-[11px]`}
          stroke="var(--card)"
          strokeWidth={4}
          paintOrder="stroke"
        >
          {lineLabel(e)}
        </text>
      ))}
    </svg>
  );
}

function NodeLink({ node }: { node: GNode | undefined }) {
  if (!node) return null;
  const text = (
    <>
      {node.label}
      <span className="ml-1.5 text-xs text-muted-foreground">
        {node.ghost && node.kind !== "other"
          ? `${KIND[node.kind]} (not found here)`
          : node.kind === "other"
            ? node.sub
            : KIND[node.kind]}
      </span>
    </>
  );
  return node.href && !node.ghost ? (
    <Link className="font-medium text-primary hover:underline" href={node.href}>
      {text}
    </Link>
  ) : (
    <span className="font-medium">{text}</span>
  );
}

function NodeBox({ node, x, y }: { node: GNode; x: number; y: number }) {
  const Icon = ICON[node.kind];
  const body = (
    <g transform={`translate(${x} ${y})`} className="group">
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        className={`fill-card stroke-border group-hover:stroke-primary ${node.ghost ? "[stroke-dasharray:5_3]" : ""}`}
        strokeWidth={1.5}
      />
      <foreignObject x={10} y={8} width={NODE_W - 20} height={NODE_H - 12}>
        <div className="flex h-full items-center gap-2 text-foreground">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              <span className="sr-only">
                {KIND[node.kind]} {node.label}
              </span>
              <span aria-hidden>{clipMiddle(node.label, 20)}</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {node.sub ?? (node.ghost ? "not found here" : KIND[node.kind])}
            </div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
  return node.href && !node.ghost ? <Link href={node.href}>{body}</Link> : body;
}
