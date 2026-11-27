import { arnName, deliversOnEmulator, type Health } from "../sns/logic";

// The message flow of a target: which topics deliver to which queues and functions, which queues trigger which
// functions, which queues are dead-letter queues of others and which rules send events from a bus to what. Pure (no calls, no React): the view feeds it what it
// read, and the layout turns it into columns.

export type NodeKind = "topic" | "queue" | "function" | "bus" | "other";
export type GNode = {
  id: string; // an ARN, or ext:… for something that has none
  kind: NodeKind;
  label: string;
  sub?: string;
  href?: string;
  ghost?: boolean; // referenced but not found: deleted, or in another region
};
export type EdgeKind = "subscription" | "event-source" | "dead-letter" | "rule";
// What a delivery check can say. A queue, function or topic target is checked; anything else is "not-checked".
export type EdgeHealth = Health | "pending" | "no-delivery" | "not-checked";
export type GEdge = {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  health?: EdgeHealth; // subscriptions and rules
  note?: string;
  label?: string; // a rule's name
  href?: string; // where the connection itself can be edited (a rule's page)
  disabled?: boolean; // a rule that is switched off
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
  // The rules of every event bus, each with its targets and whether they will receive from it.
  rules?: {
    bus: string;
    busArn: string;
    rule: string;
    ruleArn: string;
    enabled: boolean;
    targets: { id: string; arn: string; health: EdgeHealth }[];
  }[];
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

  // A bus appears once it has a rule; a rule with no target draws no line (the bus is then listed as not connected).
  // All buses first: a rule may send to another bus, which has to be there already or it would be drawn as not found.
  for (const r of input.rules ?? [])
    if (!nodes.has(r.busArn))
      add({
        id: r.busArn,
        kind: "bus",
        label: r.bus,
        sub: "event bus",
        href: `${input.base}/eventbridge/${encodeURIComponent(r.bus)}`,
      });
  for (const r of input.rules ?? [])
    for (const t of r.targets)
      edges.push({
        id: `rule:${r.ruleArn}>${t.id}`,
        kind: "rule",
        from: r.busArn,
        to: ensure(t.arn),
        health: t.health,
        label: r.rule,
        disabled: !r.enabled,
        href: `${input.base}/eventbridge/${encodeURIComponent(r.bus)}/${encodeURIComponent(r.rule)}`,
      });
  return { nodes: [...nodes.values()], edges };
}

// ---- layout ----------------------------------------------------------------------------------------------------

export const NODE_W = 210;
export const NODE_H = 54;
export const COL_GAP = 150; // room for a rule's name on its line
const ROW_GAP = 18;
const PAD = 16;
const PARALLEL_GAP = 14;

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

  // Lines between the same two boxes (two rules sending to one queue) are spread apart, or they would be one line.
  const siblings = new Map<string, string[]>();
  for (const e of g.edges) siblings.set(`${e.from}>${e.to}`, [...(siblings.get(`${e.from}>${e.to}`) ?? []), e.id]);
  const spread = (e: GEdge) => {
    const ids = siblings.get(`${e.from}>${e.to}`)!;
    return (ids.indexOf(e.id) - (ids.length - 1) / 2) * PARALLEL_GAP;
  };

  const placedEdges: PlacedEdge[] = g.edges.map((e) => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const off = spread(e);
    const forward = b.x > a.x;
    const x1 = forward ? a.x + NODE_W : a.x + NODE_W / 2 + off;
    const y1 = a.y + NODE_H / 2 + (forward ? off : 0);
    const x2 = forward ? b.x : b.x + NODE_W / 2 + off;
    const y2 = b.y + NODE_H / 2 + (forward ? off : 0);
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

// ---- flows (connected groups) ------------------------------------------------------------------------------------

// A connection that needs a look: a missing permission or endpoint, a delivery that could not be checked, a function
// trigger that is not enabled. A rule that is switched off on purpose is not a problem.
export function isProblem(e: GEdge): boolean {
  if (e.kind === "event-source") return !!e.note;
  if (e.disabled) return false;
  return e.health === "needs-permission" || e.health === "missing" || e.health === "unknown";
}

export type Flow = { id: string; title: string; graph: Graph; problems: number };

// Splits a graph into the groups of resources that are connected to each other, so that a hundred resources become
// a few small diagrams instead of one big one. Groups with problems come first, then the bigger ones.
export function splitFlows(g: Graph): Flow[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = x; c !== r;) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const e of g.edges) {
    for (const id of [e.from, e.to]) if (!parent.has(id)) parent.set(id, id);
    parent.set(find(e.from), find(e.to));
  }
  const groups = new Map<string, Graph>();
  const group = (id: string) => {
    const root = find(id);
    let gr = groups.get(root);
    if (!gr) groups.set(root, (gr = { nodes: [], edges: [] }));
    return gr;
  };
  for (const n of g.nodes) if (parent.has(n.id)) group(n.id).nodes.push(n);
  for (const e of g.edges) group(e.from).edges.push(e);

  const flows = [...groups.values()].map((graph): Flow => {
    const targets = new Set(graph.edges.map((e) => e.to));
    const sources = graph.nodes.filter((n) => !targets.has(n.id));
    const named = (sources.length ? sources : graph.nodes).map((n) => n.label).sort((a, b) => a.localeCompare(b));
    const title = named.length > 2 ? `${named.slice(0, 2).join(", ")} and ${named.length - 2} more` : named.join(", ");
    return {
      id: graph.nodes.map((n) => n.id).sort()[0]!,
      title,
      graph,
      problems: graph.edges.filter(isProblem).length,
    };
  });
  return flows.sort(
    (a, b) =>
      Number(b.problems > 0) - Number(a.problems > 0) ||
      b.graph.nodes.length - a.graph.nodes.length ||
      a.title.localeCompare(b.title),
  );
}

export type FlowFilter = { problemsOnly: boolean; query: string };

// The groups to show: only those with a problem, and only those with a resource or connection matching the search.
export function filterFlows(flows: Flow[], f: FlowFilter): Flow[] {
  const q = f.query.trim().toLowerCase();
  return flows.filter(
    (fl) =>
      (!f.problemsOnly || fl.problems > 0) &&
      (!q ||
        fl.graph.nodes.some((n) => n.label.toLowerCase().includes(q)) ||
        fl.graph.edges.some((e) => (e.label ?? "").toLowerCase().includes(q))),
  );
}
