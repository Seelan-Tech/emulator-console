import { referencedVars, VAR_NAME, VAR_PATH } from "./fixture-vars";
import type { RecordedStep } from "./recorder-timing";

// Links the steps the recorder captures: an id one call returned and a later call used becomes a fixture variable
// (`capture` on the first step, `{{name}}` in the later one), so a replay does not depend on the id being the same.
// Pure, so the recorder, its tests and the fixture it saves share it.

// Only values shaped like an id the emulator makes up are linked. Matching any string would tie together things
// that merely look alike (a billing mode, a region, a runtime name).
const ID_SHAPES = [
  /^arn:aws[a-z-]*:\S+$/, // any ARN
  /^https?:\/\/\S+$/, // a URL, such as a queue URL
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // a UUID, such as a KMS key id
  /^[a-z]+-[0-9a-f]{8,17}$/, // i-…, vpc-…, sg-…, subnet-…
  /^[A-Z0-9]{16,}$/, // IAM ids (AIDA…, AROA…) and access key ids
];
export const looksGenerated = (v: string) => v.length <= 2048 && ID_SHAPES.some((re) => re.test(v));

const MAX_LEAVES = 200;
const MAX_DEPTH = 8;

// The id-shaped strings in an output, by path ("QueueUrl", "Subnets[0].SubnetId"). A value the user typed in the same
// step (it is in `input`) is not an id the emulator made up. Keys the capture syntax cannot name are skipped.
export function generatedIds(output: unknown, input: unknown): Record<string, string> {
  const typed = JSON.stringify(input ?? null);
  const found: Record<string, string> = {};
  let count = 0;
  const walk = (v: unknown, path: string, depth: number) => {
    if (count >= MAX_LEAVES || depth > MAX_DEPTH) return;
    if (typeof v === "string") {
      if (path && looksGenerated(v) && VAR_PATH.test(path) && !typed.includes(JSON.stringify(v).slice(1, -1))) {
        found[path] = v;
        count++;
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v))
        if (/^[A-Za-z0-9_]+$/.test(k)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(output, "", 0);
  return found;
}

const mapStrings = (v: unknown, f: (s: string) => string): unknown => {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  return v;
};
const contains = (v: unknown, text: string): boolean => {
  let hit = false;
  mapStrings(v, (s) => ((hit ||= s.includes(text)), s));
  return hit;
};
const replaceAll = (v: unknown, from: string, to: string) => mapStrings(v, (s) => s.split(from).join(to));

// QueueUrl -> queueUrl, Subnets[0].SubnetId -> subnetId, Urls[1] -> urls1; made unique among the captures so far.
function freshName(path: string, steps: RecordedStep[]): string {
  const last = /([A-Za-z0-9_]+)(?:\[(\d+)\])?$/.exec(path);
  let base = (last?.[1] ?? "value").replace(/^[A-Z]/, (c) => c.toLowerCase()) + (last?.[2] ?? "");
  if (!VAR_NAME.test(base)) base = `v${base}`;
  const taken = new Set(steps.flatMap((s) => Object.keys(s.capture ?? {})));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  return name;
}

const withKey = (
  step: RecordedStep,
  key: "links" | "produced" | "capture",
  value: Record<string, string> | undefined,
): RecordedStep => {
  const copy = { ...step };
  if (value && Object.keys(value).length) copy[key] = value;
  else delete copy[key];
  return copy;
};

// Adds a recorded step. With `link` on, ids an earlier step returned and this one uses are replaced by variables
// (an id two earlier steps returned is left alone: it is not clear which one was meant).
export function addLinked(steps: RecordedStep[], step: RecordedStep, output: unknown, link = true): RecordedStep[] {
  const next = steps.map((s) => s);
  let added = step;
  if (link) {
    const sources = new Map<string, { index: number; path: string }[]>();
    steps.forEach((s, index) => {
      for (const [path, value] of Object.entries(s.produced ?? {})) {
        const list = sources.get(value) ?? [];
        if (!list.some((x) => x.index === index)) list.push({ index, path });
        sources.set(value, list);
      }
    });
    const usable = [...sources]
      .filter(([, list]) => list.length === 1)
      .map(([value, list]) => ({ value, ...list[0]! }))
      .sort((a, b) => b.value.length - a.value.length); // a longer id first, so one that contains another wins
    let input = step.input as unknown;
    const links: Record<string, string> = {};
    for (const u of usable) {
      if (!contains(input, u.value)) continue;
      const source = next[u.index]!;
      let name = Object.entries(source.capture ?? {}).find(([, p]) => p === u.path)?.[0];
      if (!name) {
        name = freshName(u.path, next);
        next[u.index] = { ...source, capture: { ...source.capture, [name]: u.path } };
      }
      input = replaceAll(input, u.value, `{{${name}}}`);
      links[name] = u.value;
    }
    if (Object.keys(links).length) added = { ...step, input: input as RecordedStep["input"], links };
  }
  return [...next, withKey(added, "produced", generatedIds(output, step.input))];
}

// Puts the value back where a step uses a variable, and drops the capture if nothing else uses it.
export function unlink(steps: RecordedStep[], index: number, name: string): RecordedStep[] {
  const step = steps[index];
  const value = step?.links?.[name];
  if (!step || value === undefined) return steps;
  const { [name]: _gone, ...links } = step.links!;
  const input = replaceAll(step.input, `{{${name}}}`, value) as RecordedStep["input"];
  return pruneCapture(
    steps.map((s, j) => (j === index ? withKey({ ...s, input }, "links", links) : s)),
    name,
  );
}

function pruneCapture(steps: RecordedStep[], name: string): RecordedStep[] {
  if (steps.some((s) => referencedVars(s.input).includes(name))) return steps;
  return steps.map((s) => {
    if (!s.capture || !(name in s.capture)) return s;
    const { [name]: _gone, ...rest } = s.capture;
    return withKey(s, "capture", rest);
  });
}

// Removes a step. Steps that used a value it captured get the value back, so none is left with an unset variable.
export function removeStep(steps: RecordedStep[], index: number): RecordedStep[] {
  const removed = steps[index];
  if (!removed) return steps;
  let cur = steps;
  for (const name of Object.keys(removed.capture ?? {}))
    cur.forEach((s, j) => {
      if (j > index && s.links && name in s.links) cur = unlink(cur, j, name);
    });
  cur = cur.filter((_, j) => j !== index);
  for (const name of Object.keys(removed.links ?? {})) cur = pruneCapture(cur, name);
  return cur;
}

// The step as one command or call on its own, with the values of its variables back in.
export function literalStep(step: RecordedStep): RecordedStep {
  let input = step.input as unknown;
  for (const [name, value] of Object.entries(step.links ?? {})) input = replaceAll(input, `{{${name}}}`, value);
  return { ...step, input: input as RecordedStep["input"] };
}

// What goes into a fixture: the steps without the recorder's own bookkeeping.
export const toFixtureSteps = (steps: RecordedStep[]) =>
  steps.map(({ links: _links, produced: _produced, ...step }) => step);
