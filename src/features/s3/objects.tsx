"use client";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  Folder,
  FolderPlus,
  Home,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog, CopyButton, EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { callOp, useMutateOp, useRunOp } from "@/lib/aws-client";
import { cn, formatBytes, timeAgo } from "@/lib/utils";

import { useS3List } from "./hooks";
import {
  breadcrumbs,
  chunk,
  displayName,
  previewKind,
  s3Uri,
  type SortKey,
  sortObjects,
  validateFolderName,
} from "./keys";
import { downloadUrl, uploadFile } from "./upload";

type Upload = {
  id: number;
  name: string;
  loaded: number;
  total: number;
  status: "uploading" | "done" | "error";
  error?: string;
  abort?: () => void;
};

export function S3Objects({ bucket, prefix }: { bucket: string; prefix: string }) {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/s3`;
  const qc = useQueryClient();
  const runOp = useRunOp();
  const list = useS3List(bucket, prefix);
  const putFolder = useMutateOp("s3", "PutObject");

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ by: SortKey; dir: "asc" | "desc" }>({ by: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description?: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const pages = useMemo(() => list.data?.pages ?? [], [list.data]);
  const folders = pages
    .flatMap((p) => p.CommonPrefixes ?? [])
    .map((p) => p.Prefix!)
    .filter((p) => p.toLowerCase().includes(filter.toLowerCase()));
  const files = useMemo(
    () =>
      sortObjects(
        pages
          .flatMap((p) => p.Contents ?? [])
          .filter((o) => o.Key !== prefix)
          .map((o) => ({ key: o.Key!, size: o.Size ?? 0, modified: o.LastModified })),
        sort.by,
        sort.dir,
        prefix,
      ).filter((o) => displayName(o.key, prefix).toLowerCase().includes(filter.toLowerCase())),
    [pages, sort, prefix, filter],
  );

  const go = (p: string) => `${base}/${encodeURIComponent(bucket)}${p ? `?prefix=${encodeURIComponent(p)}` : ""}`;
  const toggleSort = (by: SortKey) =>
    setSort((s) => (s.by === by ? { by, dir: s.dir === "asc" ? "desc" : "asc" } : { by, dir: "asc" }));
  const SortIcon = ({ by }: { by: SortKey }) =>
    sort.by === by ? (
      sort.dir === "asc" ? (
        <ArrowUp className="inline size-3" />
      ) : (
        <ArrowDown className="inline size-3" />
      )
    ) : null;

  const startUploads = useCallback(
    (fileList: FileList | File[]) => {
      for (const file of Array.from(fileList)) {
        const id = nextId.current++;
        const key = prefix + file.name;
        const patch = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
        const h = uploadFile({
          tid,
          region,
          bucket,
          key,
          file,
          onProgress: (loaded, total) => patch({ loaded, total }),
        });
        setUploads((u) => [
          ...u,
          { id, name: file.name, loaded: 0, total: file.size, status: "uploading", abort: h.abort },
        ]);
        h.promise.then(
          () => {
            patch({ status: "done", loaded: file.size });
            void qc.invalidateQueries({ queryKey: [tid, "s3"] });
          },
          (e: Error) => {
            patch({ status: "error", error: e.message });
            toast.error(`${file.name}: ${e.message}`);
          },
        );
      }
    },
    [tid, region, bucket, prefix, qc],
  );

  async function deleteKeys(keys: string[]) {
    for (const batch of chunk(keys, 1000)) {
      const out = await runOp<{ Errors?: { Key?: string; Message?: string }[] }>("s3", "DeleteObjects", {
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      });
      const first = out.Errors?.[0];
      if (first) throw new Error(`${first.Key}: ${first.Message}`);
    }
    setSelected(new Set());
    toast.success(`Deleted ${keys.length} object${keys.length === 1 ? "" : "s"}`);
  }

  // A folder is only a prefix: deleting it means listing every key beneath it.
  async function deleteFolder(folder: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await callOp<{
        Contents?: { Key?: string }[];
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      }>(tid, "s3", "ListObjectsV2", { Bucket: bucket, Prefix: folder, ContinuationToken: token }, region);
      keys.push(...(page.Contents ?? []).map((o) => o.Key!));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    await deleteKeys(keys);
  }

  const crumbs = breadcrumbs(prefix);
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.key));

  return (
    <div
      className={cn("mx-auto w-full max-w-6xl p-6", dragging && "bg-accent/30")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) startUploads(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title={bucket}
        actions={
          <>
            <Button variant="outline" onClick={() => setFolderDialog(true)}>
              <FolderPlus /> New folder
            </Button>
            <Button onClick={() => fileInput.current?.click()}>
              <Upload /> Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="file-input"
              onChange={(e) => {
                if (e.target.files) startUploads(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        }
      >
        <nav aria-label="Path" className="mb-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href={base} className="inline-flex items-center gap-1 hover:text-foreground">
            <Home className="size-3.5" /> Buckets
          </Link>
          <ChevronRight className="size-3.5" />
          <Link href={go("")} className={cn("hover:text-foreground", !prefix && "font-medium text-foreground")}>
            {bucket}
          </Link>
          {crumbs.map((c, i) => (
            <span key={c.prefix} className="inline-flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              <Link
                href={go(c.prefix)}
                className={cn("hover:text-foreground", i === crumbs.length - 1 && "font-medium text-foreground")}
              >
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="w-64 pl-8"
            placeholder="Filter this folder"
            aria-label="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              setConfirm({
                title: `Delete ${selected.size} object${selected.size === 1 ? "" : "s"}?`,
                run: () => deleteKeys([...selected]),
              })
            }
          >
            <Trash2 /> Delete {selected.size} selected
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">Drop files anywhere to upload</span>
      </div>

      {uploads.length > 0 && (
        <div className="mb-3 grid gap-1 rounded-lg border p-3" data-testid="uploads">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-sm">
              <span className="w-56 truncate">{u.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className={cn("h-full", u.status === "error" ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${u.total ? Math.round((u.loaded / u.total) * 100) : 0}%` }}
                />
              </div>
              <span className="w-28 text-right text-xs text-muted-foreground">
                {u.status === "uploading"
                  ? `${formatBytes(u.loaded)} / ${formatBytes(u.total)}`
                  : u.status === "done"
                    ? "uploaded"
                    : u.error}
              </span>
              {u.status === "uploading" ? (
                <Button size="icon-sm" variant="ghost" aria-label="Cancel upload" onClick={u.abort}>
                  <X />
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Dismiss"
                  onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {list.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : list.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {list.error.message}
        </p>
      ) : folders.length + files.length === 0 ? (
        <EmptyState
          icon={<Folder />}
          title={filter ? "No matches" : "This folder is empty"}
          description={filter ? "Try a different filter." : "Drop files here or use Upload."}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  onCheckedChange={(v) => setSelected(v ? new Set(files.map((f) => f.key)) : new Set())}
                />
              </TH>
              <TH>
                <button onClick={() => toggleSort("name")}>
                  Name <SortIcon by="name" />
                </button>
              </TH>
              <TH>
                <button onClick={() => toggleSort("size")}>
                  Size <SortIcon by="size" />
                </button>
              </TH>
              <TH>
                <button onClick={() => toggleSort("modified")}>
                  Modified <SortIcon by="modified" />
                </button>
              </TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {folders.map((f) => (
              <TR key={f}>
                <TD />
                <TD>
                  <Link
                    className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
                    href={go(f)}
                  >
                    <Folder className="size-4" />
                    {displayName(f, prefix)}
                  </Link>
                </TD>
                <TD />
                <TD />
                <TD className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete folder ${displayName(f, prefix)}`}
                    onClick={() =>
                      setConfirm({
                        title: `Delete folder “${displayName(f, prefix)}”?`,
                        description: "Every object inside it is deleted.",
                        run: () => deleteFolder(f),
                      })
                    }
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </TD>
              </TR>
            ))}
            {files.map((o) => {
              const name = displayName(o.key, prefix);
              return (
                <TR key={o.key} data-state={selected.has(o.key) ? "selected" : undefined}>
                  <TD>
                    <Checkbox
                      aria-label={`Select ${name}`}
                      checked={selected.has(o.key)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v) n.add(o.key);
                          else n.delete(o.key);
                          return n;
                        })
                      }
                    />
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      <FileIcon className="size-4 text-muted-foreground" />
                      {name}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground">{formatBytes(o.size)}</TD>
                  <TD className="text-muted-foreground" title={o.modified}>
                    {timeAgo(o.modified)}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-0.5">
                      {previewKind(o.key) && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Preview ${name}`}
                          onClick={() => setPreview(o.key)}
                        >
                          <Eye />
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" asChild>
                        <a aria-label={`Download ${name}`} href={downloadUrl(tid, bucket, o.key, { region })}>
                          <Download />
                        </a>
                      </Button>
                      <CopyButton value={s3Uri(bucket, o.key)} label={`Copy S3 URI of ${name}`} />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${name}`}
                        onClick={() => setConfirm({ title: `Delete “${name}”?`, run: () => deleteKeys([o.key]) })}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {list.hasNextPage && (
        <div className="mt-3 text-center">
          <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage && <Spinner />} Load more
          </Button>
        </div>
      )}

      <Dialog open={folderDialog} onOpenChange={setFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const clean = folderName.trim().replace(/\/+$/, "");
              await putFolder.mutateAsync({ Bucket: bucket, Key: `${prefix}${clean}/`, Body: "" }).then(
                () => {
                  setFolderDialog(false);
                  setFolderName("");
                },
                () => {},
              );
            }}
          >
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="folder-name"
              aria-label="Folder name"
              autoFocus
            />
            <DialogFooter>
              <Button disabled={!!validateFolderName(folderName) || putFolder.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        onConfirm={async () => {
          try {
            await confirm!.run();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
      {preview && (
        <PreviewDialog tid={tid} region={region} bucket={bucket} objectKey={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function PreviewDialog({
  tid,
  region,
  bucket,
  objectKey,
  onClose,
}: {
  tid: string;
  region: string;
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) {
  const kind = previewKind(objectKey);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const url = downloadUrl(tid, bucket, objectKey, { region, inline: kind === "text" });
  useEffect(() => {
    if (kind !== "text") return;
    let cancelled = false;
    fetch(url).then(
      async (r) => {
        if (cancelled) return;
        if (r.ok) setText((await r.text()).slice(0, 200_000));
        else setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [kind, url]);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate font-mono text-sm">{objectKey}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- an authenticated binary from our own API; next/image cannot proxy it
          <img src={url} alt={objectKey} className="max-h-[60vh] max-w-full rounded border object-contain" />
        ) : text === null ? (
          <Skeleton className="h-40" />
        ) : (
          <pre
            className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs"
            data-testid="preview-text"
          >
            {text}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
