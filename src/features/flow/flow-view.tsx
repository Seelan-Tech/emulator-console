"use client";
import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarClock, FunctionSquare, GitFork, Globe, Inbox, RotateCw } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

import { buildGraph, type GEdge, type GNode, layout, NODE_H, NODE_W, type NodeKind } from "./graph";
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

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// What the diagram writes on a line: a rule is just its name (the table and the tooltip say the rest), the rest are as is.
export function lineLabel(e: Pick<GEdge, "kind" | "health" | "note" | "label" | "disabled">): string {
  if (e.kind !== "rule") return edgeLook(e).label;
  return `${clip(e.label ?? "rule", 18)}${e.disabled ? " (off)" : ""}`;
}

export function FlowView() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}`;
  const flow = useQuery({ queryKey: [tid, "flow", region], queryFn: () => loadFlow(tid, region) });
  const graph = useMemo(() => (flow.data ? buildGraph({ base, ...flow.data.parts }) : null), [flow.data, base]);
  const placed = useMemo(() => (graph ? layout(graph) : null), [graph]);
  const byId = new Map(graph?.nodes.map((n) => [n.id, n]) ?? []);

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
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : flow.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {flow.error.message}
        </p>
      ) : placed && graph ? (
        <div className="grid gap-6">
          {flow.data!.warnings.map((w) => (
            <p key={w} className="text-sm text-warning-text" role="status">
              Could not read {w}
            </p>
          ))}
          {placed.edges.length === 0 ? (
            <EmptyState
              icon={<GitFork />}
              title="Nothing is connected yet"
              description="Subscribe a queue or function to a topic, give a queue a dead-letter queue, or add a Lambda event source: the connections show up here."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border bg-card p-2" data-testid="flow-diagram">
                <svg
                  width={placed.width}
                  height={placed.height}
                  viewBox={`0 0 ${placed.width} ${placed.height}`}
                  role="group"
                  aria-label="Message flow diagram. The same connections are listed in the table below."
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {placed.edges.map((e) => {
                    const look = edgeLook(e);
                    return (
                      <g key={e.id} className={look.tone}>
                        <title>{look.label}</title>
                        <path
                          d={e.path}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.75}
                          strokeDasharray={look.dashed ? "6 4" : undefined}
                          markerEnd="url(#arrow)"
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
              </div>
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
          {placed.isolated.length > 0 && (
            <section aria-label="Not connected">
              <h2 className="mb-2 text-sm font-semibold">Not connected</h2>
              <ul className="flex flex-wrap gap-2">
                {placed.isolated.map((n) => (
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
          {placed.edges.length > 0 && (
            <section aria-label="Connections">
              <h2 className="mb-2 text-sm font-semibold">Connections</h2>
              <Table data-testid="flow-table">
                <THead>
                  <TR>
                    <TH>From</TH>
                    <TH>To</TH>
                    <TH>What</TH>
                  </TR>
                </THead>
                <TBody>
                  {placed.edges.map((e) => {
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
              <span className="sr-only">{KIND[node.kind]} </span>
              {node.label}
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
