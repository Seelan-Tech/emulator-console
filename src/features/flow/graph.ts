import { arnName, deliversOnEmulator, type Health } from "../sns/logic";

// The message flow of a target: which topics deliver to which queues and functions, which queues trigger which
// functions and which queues are dead-letter queues of others. Pure (no calls, no React): the view feeds it what it
// read, and the layout turns it into columns.

export type NodeKind = "topic" | "queue" | "function" | "other";
export type GNode = {
  id: string; // an ARN, or ext:… for something that has none
  kind: NodeKind;
  label: string;
  sub?: string;
  href?: string;
  ghost?: boolean; // referenced but not found: deleted, or in another region
};
export type EdgeKind = "subscription" | "event-source" | "dead-letter";
export type GEdge = {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  health?: Health | "pending" | "no-delivery"; // subscriptions only
  note?: string;
};
export type Graph = { nodes: GNode[]; edges: GEdge[] };

export type FlowInput = {
  base: string; // /t/<tid>
  topics: {
    arn: string;
    subscriptions: { arn: string; protocol: string; endpoint: string; health?: Health }[];
  }[];
  queues: {
    url: string;
    name: string;
    arn: string;
    available: number;
    inFlight: number;
    delayed: number;
    deadLetterTargetArn?: string;
  }[];
  functions: { name: string; arn: string }[];
  mappings: { id: string; functionArn: string; eventSourceArn: string; state?: string }[];
};

// A function ARN with a version or alias (…:function:name:live) is the function itself.
const baseFunctionArn = (arn: string) => arn.split(":").slice(0, 7).join(":");
const arnService = (arn: string) => arn.split(":")[2] ?? "";

export function buildGraph(input: FlowInput): Graph {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const add = (n: GNode) => nodes.set(n.id, n);

  for (const t of input.topics)
    add({
      id: t.arn,
      kind: "topic",
      label: arnName(t.arn),
      href: `${input.base}/sns/${encodeURIComponent(arnName(t.arn))}`,
    });
  for (const q of input.queues) {
    const waiting = [
      q.available ? `${q.available} waiting` : "",
      q.inFlight ? `${q.inFlight} in flight` : "",
      q.delayed ? `${q.delayed} delayed` : "",
    ].filter(Boolean);
    add({
      id: q.arn,
      kind: "queue",
      label: q.name,
      sub: waiting.join(" · ") || "empty",
      href: `${input.base}/sqs/${encodeURIComponent(q.name)}`,
    });
  }
  for (const f of input.functions)
    add({
      id: baseFunctionArn(f.arn),
      kind: "function",
      label: f.name,
      href: `${input.base}/lambda/${encodeURIComponent(f.name)}`,
    });

  // Something that an edge names but the reads did not find.
  const ensure = (arn: string): string => {
    const id = arnService(arn) === "lambda" ? baseFunctionArn(arn) : arn;
    if (nodes.has(id)) return id;
    const svc = arnService(arn);
    const kind: NodeKind = svc === "sqs" ? "queue" : svc === "lambda" ? "function" : svc === "sns" ? "topic" : "other";
    add({
      id,
      kind,
      label: arnName(arn).split("/").pop() ?? arnName(arn),
      sub: kind === "other" ? svc || "other" : "not found here",
      ghost: true,
    });
    return id;
  };

  for (const t of input.topics) {
    for (const s of t.subscriptions) {
      const pending = s.arn === "PendingConfirmation";
      let to: string;
      if (s.protocol === "sqs" || s.protocol === "lambda") to = ensure(s.endpoint);
      else {
        to = `ext:${s.protocol}:${s.endpoint}`;
        add({ id: to, kind: "other", label: s.endpoint, sub: s.protocol, ghost: true });
      }
      const delivers = deliversOnEmulator(s.protocol as never);
      edges.push({
        id: `sub:${t.arn}>${to}:${s.arn}`,
        kind: "subscription",
        from: t.arn,
        to,
        health: !delivers ? "no-delivery" : pending ? "pending" : (s.health ?? "unknown"),
      });
    }
  }
  for (const q of input.queues)
    if (q.deadLetterTargetArn)
      edges.push({
        id: `dlq:${q.arn}>${q.deadLetterTargetArn}`,
        kind: "dead-letter",
        from: q.arn,
        to: ensure(q.deadLetterTargetArn),
      });
  for (const m of input.mappings) {
    const from = ensure(m.eventSourceArn);
    const to = ensure(m.functionArn);
    edges.push({
      id: `esm:${m.id}`,
      kind: "event-source",
      from,
      to,
      note: m.state && m.state !== "Enabled" ? m.state : undefined,
    });
  }
  return { nodes: [...nodes.values()], edges };
}

// ---- layout ----------------------------------------------------------------------------------------------------

export const NODE_W = 210;
export const NODE_H = 54;
const COL_GAP = 110;
const ROW_GAP = 18;
const PAD = 16;

export type PlacedNode = GNode & { x: number; y: number; layer: number };
export type PlacedEdge = GEdge & { path: string; mid: { x: number; y: number } };
export type Layout = { width: number; height: number; nodes: PlacedNode[]; edges: PlacedEdge[]; isolated: GNode[] };

// Columns by the longest path from a source, rows ordered to keep lines from crossing. Nodes with no connection are
// returned apart: a column of them would only push the connected ones aside.
export function layout(g: Graph): Layout {
  const connected = new Set(g.edges.flatMap((e) => [e.from, e.to]));
  const nodes = g.nodes.filter((n) => connected.has(n.id));
  const isolated = g.nodes.filter((n) => !connected.has(n.id));

  const layer = new Map(nodes.map((n) => [n.id, 0]));
  // relaxation; a cycle would grow forever, so the number of rounds is bounded
  for (let round = 0; round < nodes.length; round++) {
    let changed = false;
    for (const e of g.edges) {
      const next = layer.get(e.from)! + 1;
      if (e.from !== e.to && next > layer.get(e.to)! && next < nodes.length) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns: GNode[][] = [];
  for (const n of [...nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    const l = layer.get(n.id)!;
    (columns[l] ??= []).push(n);
  }
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];

  const neighbours = (id: string, dir: "in" | "out") =>
    g.edges.flatMap((e) => (dir === "in" && e.to === id ? [e.from] : dir === "out" && e.from === id ? [e.to] : []));
  const rowOf = new Map<string, number>();
  const index = () => columns.forEach((c) => c.forEach((n, i) => rowOf.set(n.id, i)));
  index();
  // barycenter sweeps: each node moves toward the average row of the nodes it connects to
  const sweep = (order: number[], dir: "in" | "out") => {
    for (const i of order) {
      const key = (n: GNode) => {
        const rs = neighbours(n.id, dir)
          .map((id) => rowOf.get(id))
          .filter((r): r is number => r !== undefined);
        return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : rowOf.get(n.id)!;
      };
      const keyed = columns[i]!.map((n) => ({ n, k: key(n) }));
      keyed.sort((a, b) => a.k - b.k || a.n.label.localeCompare(b.n.label));
      columns[i] = keyed.map((x) => x.n);
      index();
    }
  };
  const idx = columns.map((_, i) => i);
  for (let pass = 0; pass < 3; pass++) {
    sweep(idx.slice(1), "in");
    sweep([...idx].reverse().slice(1), "out");
  }

  const placed = new Map<string, PlacedNode>();
  columns.forEach((col, l) =>
    col.forEach((n, r) =>
      placed.set(n.id, { ...n, layer: l, x: PAD + l * (NODE_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP) }),
    ),
  );

  const placedEdges: PlacedEdge[] = g.edges.map((e) => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const forward = b.x > a.x;
    const x1 = forward ? a.x + NODE_W : a.x + NODE_W / 2;
    const y1 = a.y + NODE_H / 2;
    const x2 = forward ? b.x : b.x + NODE_W / 2;
    const y2 = b.y + NODE_H / 2;
    const dx = forward ? Math.max(40, (x2 - x1) / 2) : 0;
    // a line that does not go forward (same column, or a loop) leaves from the bottom and comes in at the top
    const path = forward
      ? `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${a.y + NODE_H} C ${x1 + 60} ${a.y + NODE_H + 40}, ${x2 + 60} ${b.y - 40}, ${x2} ${b.y}`;
    return { ...e, path, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
  });

  const rows = Math.max(0, ...columns.map((c) => c.length));
  return {
    width: PAD * 2 + columns.length * NODE_W + Math.max(0, columns.length - 1) * COL_GAP,
    height: PAD * 2 + rows * NODE_H + Math.max(0, rows - 1) * ROW_GAP,
    nodes: [...placed.values()],
    edges: placedEdges,
    isolated,
  };
}
