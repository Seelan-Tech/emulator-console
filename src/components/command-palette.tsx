"use client";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  actionItems,
  bucketItems,
  fixtureItems,
  functionItems,
  GROUP_ORDER,
  navigationItems,
  operationItems,
  type PaletteItem,
  pushRecent,
  queueItems,
  rank,
  type Ranked,
  type Recent,
  recentItems,
  secretItems,
  tableItems,
  targetItems,
  topicItems,
} from "@/features/palette/items";
import { callOp } from "@/lib/aws-client";
import { api } from "@/lib/client";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/utils";

const RECENT_KEY = "palette:recent:v1";

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const hit = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        hit.has(i) ? (
          <mark key={i} className="bg-transparent font-semibold text-primary">
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

// The target we are inside, if any: /t/:tid/…
function useLocation(path: string) {
  return { tid: path.match(/^\/t\/([^/]+)/)?.[1] ?? null };
}

// A cached read that only runs while enabled. A hook (named `use…`) so the rules of hooks hold when it is called
// once per resource kind.
function useLazyQuery<T>(key: unknown[], fn: () => Promise<T>, enabled: boolean) {
  return useQuery({ queryKey: key, queryFn: fn, enabled, staleTime: 15_000, retry: false });
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const path = usePathname();
  const { setTheme } = useTheme();
  const { tid } = useLocation(path);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(storage.getJson<Recent[]>(RECENT_KEY, []));
  }, [open]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // Everything below loads only while the palette is open, and is cached so reopening is instant.
  const region = (tid && storage.get(`region:${tid}`)) || undefined;
  const useScoped = <T,>(key: string, fn: () => Promise<T>, enabled = true) =>
    useLazyQuery(["palette", tid ?? "-", key, region], fn, open && enabled);
  const swallow = <T,>(p: Promise<T>) => p.catch(() => null); // a service the emulator lacks just contributes nothing

  const targets = useScoped("targets", () => api<{ id: string; name: string }[]>("/api/targets"));
  const fixtures = useScoped("fixtures", () => api<{ id: string; name: string }[]>("/api/fixtures"));
  const buckets = useScoped(
    "buckets",
    () => swallow(callOp<{ Buckets?: { Name?: string }[] }>(tid!, "s3", "ListBuckets", {}, region)),
    !!tid,
  );
  const tables = useScoped(
    "tables",
    () => swallow(callOp<{ TableNames?: string[] }>(tid!, "dynamodb", "ListTables", {}, region)),
    !!tid,
  );
  const queues = useScoped(
    "queues",
    () => swallow(callOp<{ QueueUrls?: string[] }>(tid!, "sqs", "ListQueues", {}, region)),
    !!tid,
  );
  const fns = useScoped(
    "functions",
    () => swallow(callOp<{ Functions?: { FunctionName?: string }[] }>(tid!, "lambda", "ListFunctions", {}, region)),
    !!tid,
  );
  const topics = useScoped(
    "topics",
    () => swallow(callOp<{ Topics?: { TopicArn?: string }[] }>(tid!, "sns", "ListTopics", {}, region)),
    !!tid,
  );
  const secrets = useScoped(
    "secrets",
    () => swallow(callOp<{ SecretList?: { Name?: string }[] }>(tid!, "secretsmanager", "ListSecrets", {}, region)),
    !!tid,
  );
  const ops = useQuery({
    queryKey: ["palette", "operations"],
    queryFn: () => api<Record<string, string[]>>("/api/operations"),
    enabled: open && !!tid && query.trim().length >= 2,
    staleTime: Infinity,
  });

  const items = useMemo<PaletteItem[]>(() => {
    const names = <T,>(xs: (T | undefined)[] | undefined) => (xs ?? []).filter((x): x is T => !!x);
    return [
      ...recentItems(recent),
      ...navigationItems(tid),
      ...targetItems(targets.data ?? []),
      ...fixtureItems(fixtures.data ?? []),
      ...(tid
        ? [
            ...bucketItems(tid, names(buckets.data?.Buckets?.map((b) => b.Name))),
            ...tableItems(tid, names(tables.data?.TableNames)),
            ...queueItems(tid, names(queues.data?.QueueUrls)),
            ...functionItems(tid, names(fns.data?.Functions?.map((f) => f.FunctionName))),
            ...topicItems(tid, names(topics.data?.Topics?.map((t) => t.TopicArn))),
            ...secretItems(tid, names(secrets.data?.SecretList?.map((s) => s.Name))),
            ...operationItems(tid, ops.data ?? {}),
          ]
        : []),
      ...actionItems(),
    ];
  }, [
    tid,
    recent,
    targets.data,
    fixtures.data,
    buckets.data,
    tables.data,
    queues.data,
    fns.data,
    topics.data,
    secrets.data,
    ops.data,
  ]);

  const results = useMemo(() => rank(items, query), [items, query]);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  async function choose(it: Ranked) {
    onOpenChange(false);
    if (it.action) {
      if (it.action.startsWith("theme:")) {
        setTheme(it.action.slice(6));
        toast.success(`Theme: ${it.action.slice(6)}`);
      }
      return;
    }
    if (!it.href) return;
    storage.setJson(RECENT_KEY, pushRecent(recent, it));
    router.push(it.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) void choose(results[active]);
    }
  }

  const loading =
    open &&
    !!tid &&
    query.trim().length > 0 &&
    [buckets, tables, queues, fns, topics, secrets].some((q) => q.isLoading);
  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        aria-describedby="palette-desc"
        data-testid="palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription id="palette-desc" className="sr-only">
          Search for a page, resource or operation and press Enter to open it.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the palette exists to be typed into the moment it opens
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-item-${active}` : undefined}
            aria-label="Search"
            placeholder="Search pages, buckets, tables, queues, functions, operations…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="mr-7 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {loading ? "Searching…" : query ? `Nothing matches “${query}”.` : "Start typing to search."}
            </p>
          )}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={`${r.group}:${r.id}`}>
                {header && (
                  <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {GROUP_ORDER.find((g) => g === header)}
                  </div>
                )}
                {/* Combobox pattern: focus stays on the input (aria-activedescendant) and the keys are handled there,
                    so the options themselves are neither focusable nor key-listening. */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
                <div
                  id={`palette-item-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => void choose(r)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <Highlighted text={r.label} indices={r.indices} />
                  </span>
                  {r.hint && <span className="shrink-0 text-xs text-muted-foreground">{r.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            <kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border px-1">↵</kbd> open
          </span>
          {tid && <span className="ml-auto">Searching this target</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
