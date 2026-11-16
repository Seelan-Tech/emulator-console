"use client";
import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog, CopyButton, PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { callOp, useMutateOp, useOp } from "@/lib/aws-client";
import { hardNavigate } from "@/lib/navigation";
import { timeAgo } from "@/lib/utils";

import { mask, prettySecret } from "./logic";

type Described = {
  Name: string;
  ARN?: string;
  Description?: string;
  CreatedDate?: string;
  LastChangedDate?: string;
  DeletedDate?: string;
  Tags?: { Key: string; Value: string }[];
};
type Version = { VersionId: string; VersionStages?: string[]; CreatedDate?: string };

export function SecretView({ name }: { name: string }) {
  const { tid, region } = useTarget();
  const d = useOp<Described>("secretsmanager", "DescribeSecret", { SecretId: name });
  const versions = useOp<{ Versions?: Version[] }>("secretsmanager", "ListSecretVersionIds", {
    SecretId: name,
    IncludeDeprecated: true,
  });
  const put = useMutateOp("secretsmanager", "PutSecretValue");
  const tag = useMutateOp("secretsmanager", "TagResource");
  const untag = useMutateOp("secretsmanager", "UntagResource");
  const del = useMutateOp("secretsmanager", "DeleteSecret");
  const restore = useMutateOp("secretsmanager", "RestoreSecret");

  const [revealed, setRevealed] = useState<{ value: string; version?: string } | null>(null);
  const [loadingValue, setLoadingValue] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [tagKey, setTagKey] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [recoveryDays, setRecoveryDays] = useState("7");
  const [confirm, setConfirm] = useState<"schedule" | "force" | null>(null);
  const s = d.data;
  const deleted = !!s?.DeletedDate;

  async function reveal() {
    if (revealed) return setRevealed(null);
    setLoadingValue(true);
    try {
      const v = await callOp<{ SecretString?: string; SecretBinary?: string; VersionId?: string }>(
        tid,
        "secretsmanager",
        "GetSecretValue",
        { SecretId: name },
        region,
      );
      setRevealed({ value: v.SecretString ?? "(binary value)", version: v.VersionId });
    } catch (e) {
      toast.error((e as Error).message);
    }
    setLoadingValue(false);
  }

  const shown = revealed ? prettySecret(revealed.value) : null;

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={name}
        description={s?.Description || undefined}
        actions={
          s &&
          (deleted ? (
            <Badge variant="destructive">deletes {new Date(s.DeletedDate!).toLocaleDateString()}</Badge>
          ) : (
            <Badge variant="success">active</Badge>
          ))
        }
      >
        <Link
          href={`/t/${tid}/secrets`}
          className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← Secrets
        </Link>
      </PageHeader>
      {!s ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="mb-4 grid gap-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 font-mono">
              {s.ARN}
              {s.ARN && <CopyButton value={s.ARN} label="Copy ARN" />}
            </span>
            <span>
              Created {timeAgo(s.CreatedDate)} · last changed {timeAgo(s.LastChangedDate)}
            </span>
          </div>
          {deleted && (
            <Card className="mb-4 border-destructive/40">
              <CardContent className="flex flex-wrap items-center gap-3 pt-4 text-sm">
                <span>This secret is scheduled for deletion and its value can&apos;t be read.</span>
                <Button onClick={() => restore.mutate({ SecretId: name })} disabled={restore.isPending}>
                  <RotateCcw /> Restore secret
                </Button>
              </CardContent>
            </Card>
          )}
          <Tabs defaultValue="value">
            <TabsList>
              <TabsTrigger value="value">Value</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
              <TabsTrigger value="tags">Tags</TabsTrigger>
              <TabsTrigger value="danger">Delete</TabsTrigger>
            </TabsList>

            <TabsContent value="value">
              {deleted ? (
                <p className="text-sm text-muted-foreground">Restore the secret to read or change its value.</p>
              ) : (
                <div className="grid gap-5">
                  <Card>
                    <CardContent className="grid gap-3 pt-4">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={reveal} disabled={loadingValue}>
                          {loadingValue ? <Spinner /> : revealed ? <EyeOff /> : <Eye />}{" "}
                          {revealed ? "Hide value" : "Reveal value"}
                        </Button>
                        {revealed && <CopyButton value={revealed.value} label="Copy value" />}
                        {revealed?.version && (
                          <span className="text-xs text-muted-foreground">version {revealed.version}</span>
                        )}
                      </div>
                      {shown ? (
                        <pre
                          className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs"
                          data-testid="secret-value"
                        >
                          {shown.text}
                        </pre>
                      ) : (
                        <div className="font-mono text-sm text-muted-foreground" aria-label="Hidden value">
                          {mask("secret value")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="grid gap-3 pt-4">
                      <Label>New version</Label>
                      <CodeEditor value={newValue} onChange={setNewValue} language="text" height="120px" />
                      <p className="text-xs text-muted-foreground">
                        Saved as a new version; the previous one becomes AWSPREVIOUS.
                      </p>
                      <Button
                        className="justify-self-start"
                        disabled={!newValue || put.isPending}
                        onClick={() =>
                          put.mutate(
                            { SecretId: name, SecretString: newValue },
                            {
                              onSuccess: () => {
                                setNewValue("");
                                setRevealed(null);
                                toast.success("New version saved");
                              },
                            },
                          )
                        }
                      >
                        {put.isPending && <Spinner />} Save new version
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            <TabsContent value="versions">
              <Table>
                <THead>
                  <TR>
                    <TH>Version</TH>
                    <TH>Stages</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {(versions.data?.Versions ?? []).map((v) => (
                    <TR key={v.VersionId}>
                      <TD className="font-mono text-xs">{v.VersionId}</TD>
                      <TD>
                        <div className="flex gap-1">
                          {(v.VersionStages ?? []).length ? (
                            v.VersionStages!.map((st) => (
                              <Badge key={st} variant={st === "AWSCURRENT" ? "success" : "outline"}>
                                {st}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">deprecated</span>
                          )}
                        </div>
                      </TD>
                      <TD className="text-muted-foreground">{timeAgo(v.CreatedDate)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TabsContent>

            <TabsContent value="tags">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  className="w-44"
                  placeholder="key"
                  aria-label="Tag key"
                  value={tagKey}
                  onChange={(e) => setTagKey(e.target.value)}
                />
                <Input
                  className="w-56"
                  placeholder="value"
                  aria-label="Tag value"
                  value={tagValue}
                  onChange={(e) => setTagValue(e.target.value)}
                />
                <Button
                  disabled={!tagKey.trim() || tag.isPending}
                  onClick={() =>
                    tag.mutate(
                      { SecretId: name, Tags: [{ Key: tagKey.trim(), Value: tagValue }] },
                      {
                        onSuccess: () => {
                          setTagKey("");
                          setTagValue("");
                        },
                      },
                    )
                  }
                >
                  Add tag
                </Button>
              </div>
              {(s.Tags ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Key</TH>
                      <TH>Value</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {s.Tags!.map((t) => (
                      <TR key={t.Key}>
                        <TD>{t.Key}</TD>
                        <TD>{t.Value}</TD>
                        <TD className="text-right">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove tag ${t.Key}`}
                            onClick={() => untag.mutate({ SecretId: name, TagKeys: [t.Key] })}
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="danger">
              {deleted ? (
                <p className="text-sm text-muted-foreground">Already scheduled for deletion.</p>
              ) : (
                <Card>
                  <CardContent className="grid gap-4 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor="rw">Recovery window (days)</Label>
                      <Input
                        id="rw"
                        type="number"
                        min={7}
                        max={30}
                        value={recoveryDays}
                        onChange={(e) => setRecoveryDays(e.target.value)}
                        className="w-24"
                      />
                      <Button variant="outline" onClick={() => setConfirm("schedule")}>
                        Schedule deletion
                      </Button>
                    </div>
                    <div>
                      <Button variant="destructive" onClick={() => setConfirm("force")}>
                        <Trash2 /> Delete immediately
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <ConfirmDialog
        open={confirm === "schedule"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Schedule “${name}” for deletion?`}
        description={`It can be restored for ${recoveryDays} days.`}
        confirmLabel="Schedule deletion"
        onConfirm={() => del.mutateAsync({ SecretId: name, RecoveryWindowInDays: Number(recoveryDays) })}
      />
      <ConfirmDialog
        open={confirm === "force"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Permanently delete “${name}”?`}
        description="This cannot be undone."
        typeToConfirm={name}
        onConfirm={async () => {
          await del.mutateAsync({ SecretId: name, ForceDeleteWithoutRecovery: true });
          hardNavigate(`/t/${tid}/secrets`);
        }}
      />
    </div>
  );
}
