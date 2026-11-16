import { SERVICES } from "@/features/services";
import { fuzzyItem } from "@/lib/fuzzy";

export type Group = "Recent" | "Go to" | "Resources" | "Operations" | "Actions";
export const GROUP_ORDER: Group[] = ["Recent", "Go to", "Resources", "Operations", "Actions"];

export type PaletteItem = {
  id: string;
  group: Group;
  label: string;
  hint?: string; // right-aligned secondary text (kind, service…)
  keywords?: string; // extra words that should match
  href?: string; // navigate
  action?: string; // or run a named action (handled by the palette)
};

export type Ranked = PaletteItem & { score: number; indices: number[] };

const MAX_RESULTS = 60;
const MAX_PER_GROUP = 25;

// Filters and orders items for a query. With no query only the quick groups show (Recent, Go to, Actions): the
// long lists (resources, operations) would just be noise until you type.
export function rank(items: PaletteItem[], query: string): Ranked[] {
  const q = query.trim();
  const out: Ranked[] = [];
  // In the empty state a recent item replaces its own "Go to" row instead of appearing twice.
  const recentIds = new Set(items.filter((i) => i.group === "Recent").map((i) => i.id));
  for (const it of items) {
    if (!q && it.group !== "Recent" && recentIds.has(it.id)) continue;
    if (!q && (it.group === "Resources" || it.group === "Operations")) continue;
    if (q && it.group === "Recent") continue; // recents are only a shortcut for the empty state
    const m = fuzzyItem(q, it.label, it.keywords, it.hint);
    if (m) out.push({ ...it, score: m.score, indices: m.indices });
  }
  const byGroup = new Map<Group, Ranked[]>();
  for (const r of out) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  const ordered: Ranked[] = [];
  for (const g of GROUP_ORDER) {
    const list = byGroup.get(g) ?? [];
    if (q) list.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    ordered.push(...list.slice(0, MAX_PER_GROUP));
  }
  return ordered.slice(0, MAX_RESULTS);
}

// ---- builders ----

export function navigationItems(tid: string | null): PaletteItem[] {
  const items: PaletteItem[] = [
    { id: "nav:targets", group: "Go to", label: "Targets", href: `/`, keywords: "emulators endpoints" },
    {
      id: "nav:fixtures",
      group: "Go to",
      label: "Fixtures",
      href: `/fixtures`,
      keywords: "replay recorded baseline",
    },
    {
      id: "nav:activity",
      group: "Go to",
      label: "Activity",
      href: `/activity`,
      keywords: "audit log history",
    },
  ];
  if (tid) {
    const base = `/t/${tid}`;
    items.push({
      id: "nav:overview",
      group: "Go to",
      label: "Overview",
      href: base,
      keywords: "coverage services probe",
    });
    for (const s of SERVICES) {
      items.push({
        id: `nav:${s.id}`,
        group: "Go to",
        label: s.label,
        hint: s.native ? "screen" : "operations",
        href: s.native ? `${base}/${s.native}` : `${base}/s/${s.id}`,
        keywords: `${s.id} ${s.group}`,
      });
    }
    items.push({ id: "nav:ops", group: "Go to", label: "All operations", href: `${base}/s`, keywords: "runner api" });
  }
  return items;
}

export function actionItems(): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: "act:theme-light",
      group: "Actions",
      label: "Use light theme",
      action: "theme:light",
      keywords: "appearance",
    },
    {
      id: "act:theme-dark",
      group: "Actions",
      label: "Use dark theme",
      action: "theme:dark",
      keywords: "appearance night",
    },
    {
      id: "act:theme-system",
      group: "Actions",
      label: "Use system theme",
      action: "theme:system",
      keywords: "appearance auto",
    },
  ];
  return items;
}

const resource = (tid: string, kind: string, name: string, path: string): PaletteItem => ({
  id: `res:${kind}:${name}`,
  group: "Resources",
  label: name,
  hint: kind,
  href: `/t/${tid}/${path}`,
});

export const bucketItems = (tid: string, names: string[]) =>
  names.map((n) => resource(tid, "S3 bucket", n, `s3/${encodeURIComponent(n)}`));
export const tableItems = (tid: string, names: string[]) =>
  names.map((n) => resource(tid, "DynamoDB table", n, `dynamodb/${encodeURIComponent(n)}`));
export const queueItems = (tid: string, urls: string[]) =>
  urls.map((u) => {
    const n = u.split("/").pop()!;
    return resource(tid, "SQS queue", n, `sqs/${encodeURIComponent(n)}`);
  });
export const functionItems = (tid: string, names: string[]) =>
  names.map((n) => resource(tid, "Lambda function", n, `lambda/${encodeURIComponent(n)}`));
export const topicItems = (tid: string, arns: string[]) =>
  arns.map((a) => {
    const n = a.split(":").pop()!;
    return resource(tid, "SNS topic", n, `sns/${encodeURIComponent(n)}`);
  });
export const secretItems = (tid: string, names: string[]) =>
  names.map((n) => resource(tid, "Secret", n, `secrets/detail?name=${encodeURIComponent(n)}`));

export function operationItems(tid: string, ops: Record<string, string[]>): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const s of SERVICES)
    for (const op of ops[s.id] ?? [])
      out.push({
        id: `op:${s.id}.${op}`,
        group: "Operations",
        label: `${s.id}.${op}`,
        hint: s.label,
        href: `/t/${tid}/s/${s.id}/${op}`,
        keywords: op,
      });
  return out;
}

export const targetItems = (targets: { id: string; name: string }[]): PaletteItem[] =>
  targets.map((t) => ({
    id: `target:${t.id}`,
    group: "Go to",
    label: t.name,
    hint: "target",
    href: `/t/${t.id}`,
    keywords: "emulator",
  }));

export const fixtureItems = (fixtures: { id: string; name: string }[]): PaletteItem[] =>
  fixtures.map((f) => ({
    id: `fixture:${f.id}`,
    group: "Resources",
    label: f.name,
    hint: "fixture",
    href: `/fixtures/${f.id}`,
  }));

// ---- recents ----
export type Recent = Pick<PaletteItem, "id" | "label" | "hint" | "href">;

export function pushRecent(list: Recent[], item: PaletteItem, max = 6): Recent[] {
  if (!item.href) return list;
  return [
    { id: item.id, label: item.label, hint: item.hint, href: item.href },
    ...list.filter((r) => r.id !== item.id),
  ].slice(0, max);
}

export const recentItems = (list: Recent[]): PaletteItem[] => list.map((r) => ({ ...r, group: "Recent" as const }));
