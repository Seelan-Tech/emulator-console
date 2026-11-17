"use client";
import { useQuery } from "@tanstack/react-query";
import { HardDrive, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog, EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { callOp, useMutateOp } from "@/lib/aws-client";
import { timeAgo } from "@/lib/utils";

import type { Bucket } from "./hooks";
import { bucketRegionFrom, validateBucketName } from "./keys";

type Row = Bucket & { region?: string };

export function S3Buckets() {
  const { tid, region } = useTarget();
  const base = `/t/${tid}/s3`;
  const [onlyHere, setOnlyHere] = useState(false);
  // ListBuckets is account-wide (every region), like AWS. "Only this region" uses its BucketRegion filter; otherwise
  // each bucket's region is read with GetBucketLocation, sequentially: the emulator drops connections under bursts.
  const list = useQuery({
    queryKey: [tid, "s3", "buckets", region, onlyHere],
    queryFn: async (): Promise<Row[]> => {
      const { Buckets = [] } = await callOp<{ Buckets?: Bucket[] }>(
        tid,
        "s3",
        "ListBuckets",
        onlyHere ? { BucketRegion: region } : {},
        region,
      );
      const rows: Row[] = [];
      for (const b of Buckets) {
        if (onlyHere) {
          rows.push({ ...b, region });
          continue;
        }
        const loc = await callOp<{ LocationConstraint?: string | null }>(
          tid,
          "s3",
          "GetBucketLocation",
          { Bucket: b.Name },
          region,
        ).catch(() => null);
        rows.push({ ...b, region: loc ? bucketRegionFrom(loc.LocationConstraint) : undefined });
      }
      return rows;
    },
  });
  const create = useMutateOp("s3", "CreateBucket");
  const del = useMutateOp("s3", "DeleteBucket");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const nameError = name ? validateBucketName(name) : null;
  const buckets = list.data ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="S3 buckets"
        description="Object storage. Each bucket on this emulator holds up to 64 MiB. Buckets of every region are listed."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={onlyHere} onCheckedChange={setOnlyHere} aria-label="Only this region" /> Only {region}
            </label>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create bucket
            </Button>
          </>
        }
      />
      {list.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : list.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {list.error.message}
        </p>
      ) : buckets.length === 0 ? (
        <EmptyState
          icon={<HardDrive />}
          title="No buckets"
          description={onlyHere ? `No buckets in ${region}.` : "Create a bucket to start storing objects."}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create bucket
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Region</TH>
              <TH>Created</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {buckets.map((b) => (
              <TR key={b.Name}>
                <TD>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`${base}/${encodeURIComponent(b.Name!)}`}
                  >
                    {b.Name}
                  </Link>
                </TD>
                <TD className="text-muted-foreground">{b.region ?? "—"}</TD>
                <TD className="text-muted-foreground">{timeAgo(b.CreationDate)}</TD>
                <TD className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete bucket ${b.Name}`}
                    onClick={() => setDeleting(b.Name!)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create bucket</DialogTitle>
            <DialogDescription>Bucket names are lowercase and unique. It is created in {region}.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await create.mutateAsync({ Bucket: name }).then(
                () => {
                  setCreating(false);
                  setName("");
                },
                () => {},
              );
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-bucket"
              aria-label="Bucket name"
              autoFocus
              aria-invalid={!!nameError}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={!name || !!nameError || create.isPending}>
                {create.isPending && <Spinner />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete bucket “${deleting}”?`}
        description="The bucket must be empty."
        typeToConfirm={deleting ?? undefined}
        onConfirm={() => del.mutateAsync({ Bucket: deleting! })}
      />
    </div>
  );
}
