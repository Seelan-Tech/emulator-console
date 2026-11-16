"use client";
import { Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CodeEditor } from "@/components/code-editor";
import { EmptyState, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useMutateOp, useOp } from "@/lib/aws-client";
import { timeAgo } from "@/lib/utils";

import { secretHref, validateSecretName } from "./logic";

export type SecretListEntry = {
  Name: string;
  ARN?: string;
  Description?: string;
  LastChangedDate?: string;
  DeletedDate?: string;
};

export function SecretsList() {
  const { tid } = useTarget();
  const base = `/t/${tid}`;
  const [showDeleted, setShowDeleted] = useState(false);
  const list = useOp<{ SecretList?: SecretListEntry[] }>("secretsmanager", "ListSecrets", {
    IncludePlannedDeletion: showDeleted,
  });
  const create = useMutateOp("secretsmanager", "CreateSecret");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const nameError = name ? validateSecretName(name) : null;
  const secrets = list.data?.SecretList ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="Secrets"
        description="Credentials and configuration with versioning."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={showDeleted}
                onCheckedChange={setShowDeleted}
                aria-label="Show secrets scheduled for deletion"
              />{" "}
              Show scheduled for deletion
            </label>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create secret
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
      ) : secrets.length === 0 ? (
        <EmptyState
          icon={<Lock />}
          title="No secrets"
          description="Create a secret to store a value you can version and rotate."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create secret
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Description</TH>
              <TH>Last changed</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {secrets.map((s) => (
              <TR key={s.Name}>
                <TD>
                  <Link className="font-medium text-primary hover:underline" href={secretHref(base, s.Name)}>
                    {s.Name}
                  </Link>
                </TD>
                <TD className="text-muted-foreground">{s.Description}</TD>
                <TD className="text-muted-foreground" title={s.LastChangedDate}>
                  {timeAgo(s.LastChangedDate)}
                </TD>
                <TD>
                  {s.DeletedDate ? (
                    <Badge variant="destructive">deletes {new Date(s.DeletedDate).toLocaleDateString()}</Badge>
                  ) : (
                    <Badge variant="success">active</Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create secret</DialogTitle>
            <DialogDescription>The value is stored as text; JSON is fine.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await create
                .mutateAsync({
                  Name: name,
                  SecretString: value,
                  ...(description.trim() ? { Description: description.trim() } : {}),
                })
                .then(
                  () => {
                    setCreating(false);
                    setName("");
                    setDescription("");
                    setValue("");
                  },
                  () => {},
                );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="sec-name">Name</Label>
              <Input
                id="sec-name"
                placeholder="app/db-password"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                aria-invalid={!!nameError}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sec-desc">Description (optional)</Label>
              <Input id="sec-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Secret value</Label>
              <CodeEditor value={value} onChange={setValue} language="text" height="140px" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={!name || !!nameError || !value || create.isPending}>
                {create.isPending && <Spinner />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
