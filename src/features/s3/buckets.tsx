"use client";
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
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useMutateOp, useOp } from "@/lib/aws-client";
import { timeAgo } from "@/lib/utils";

import type { Bucket } from "./hooks";
import { validateBucketName } from "./keys";

export function S3Buckets() {
  const { tid } = useTarget();
  const base = `/t/${tid}/s3`;
  const list = useOp<{ Buckets?: Bucket[] }>("s3", "ListBuckets");
  const create = useMutateOp("s3", "CreateBucket");
  const del = useMutateOp("s3", "DeleteBucket");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const nameError = name ? validateBucketName(name) : null;
  const buckets = list.data?.Buckets ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="S3 buckets"
        description="Object storage. Each bucket on this emulator holds up to 64 MiB."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create bucket
          </Button>
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
          description="Create a bucket to start storing objects."
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
            <DialogDescription>Bucket names are lowercase and unique.</DialogDescription>
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
