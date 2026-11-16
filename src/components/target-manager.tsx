"use client";
import { Plug, Plus, Server, Settings, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, PageHeader, Spinner } from "@/components/common";
import { TargetSettings } from "@/components/target-settings";
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
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { TargetTest } from "@/lib/api-types";
import { api } from "@/lib/client";
import { emulatorTitle, type EmulatorVersion } from "@/lib/emulator-version";
import { timeAgo } from "@/lib/utils";

export type TargetView = {
  id: string;
  name: string;
  endpointUrl: string;
  region: string;
  authMode: "static" | "files";
  hasCa: boolean;
  tlsServername: string | null;
  lastSeenAt: string | null;
  emulator: EmulatorVersion | null;
};

export function TargetsView({ targets, filesEnabled }: { targets: TargetView[]; filesEnabled: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TargetView | null>(null);
  const [settingsFor, setSettingsFor] = useState<TargetView | null>(null);

  async function test(t: TargetView) {
    setTesting(t.id);
    try {
      const r = await api<TargetTest>(`/api/targets/${t.id}/test`, "POST");
      if (r.ok) toast.success(`${t.name}: connected in ${r.ms} ms as ${r.identity}`);
      else toast.error(`${t.name}: ${r.error}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setTesting(null);
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <PageHeader
        title="Targets"
        description="The emulator endpoints the console operates against."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add target
          </Button>
        }
      />
      {targets.length === 0 ? (
        <EmptyState
          icon={<Server />}
          title="No targets yet"
          description="Add your emulator to browse and change its resources, record fixtures and replay them after a restart."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add target
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Endpoint</TH>
              <TH>Credentials</TH>
              <TH>Last used</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {targets.map((t) => (
              <TR key={t.id}>
                <TD>
                  <Link className="font-medium text-primary hover:underline" href={`/t/${t.id}`}>
                    {t.name}
                  </Link>
                </TD>
                <TD>
                  <div className="font-mono text-xs">{t.endpointUrl}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.region}
                    {t.tlsServername ? ` · verify as ${t.tlsServername}` : ""}
                  </div>
                  {t.emulator && (
                    <div
                      className="text-xs text-muted-foreground"
                      title={emulatorTitle(t.emulator)}
                      data-testid="emulator-version"
                    >
                      Emulator {t.emulator.version}
                      {t.emulator.releaseDate ? ` · ${t.emulator.releaseDate}` : ""}
                    </div>
                  )}
                </TD>
                <TD>
                  <Badge variant="outline">{t.authMode === "files" ? "emulator files" : "static keys"}</Badge>
                </TD>
                <TD className="text-muted-foreground">{t.lastSeenAt ? timeAgo(t.lastSeenAt) : "never"}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => test(t)} disabled={testing === t.id}>
                      {testing === t.id ? <Spinner /> : <Zap />} Test
                    </Button>
                    <Button size="sm" asChild>
                      <Link href={`/t/${t.id}`}>
                        <Plug /> Open
                      </Link>
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Restart recovery settings for ${t.name}`}
                      onClick={() => setSettingsFor(t)}
                    >
                      <Settings />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => setDeleting(t)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {settingsFor && (
        <TargetSettings targetId={settingsFor.id} open onOpenChange={(v) => !v && setSettingsFor(null)} />
      )}
      <AddTargetDialog open={adding} onOpenChange={setAdding} filesEnabled={filesEnabled} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete target “${deleting?.name}”?`}
        description="Its audit entries are kept. Resources on the emulator are not touched."
        typeToConfirm={deleting?.name}
        onConfirm={async () => {
          try {
            await api(`/api/targets/${deleting!.id}`, "DELETE");
            toast.success("Target deleted");
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />
    </main>
  );
}

function AddTargetDialog({
  open,
  onOpenChange,
  filesEnabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filesEnabled: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: "",
    endpointUrl: "",
    region: "us-east-1",
    tlsServername: "",
    caPem: "",
    authMode: filesEnabled ? "files" : "static",
    accessKeyId: "",
    secretAccessKey: "",
    filesDir: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });
  const preset = () =>
    setF({
      ...f,
      name: "local emulator",
      endpointUrl: "https://emulator:9297",
      tlsServername: "localhost",
      authMode: "files",
      filesDir: "9297",
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload: Record<string, unknown> = {
      name: f.name,
      endpointUrl: f.endpointUrl,
      region: f.region,
      authMode: f.authMode,
    };
    if (f.tlsServername) payload.tlsServername = f.tlsServername;
    if (f.caPem.trim()) payload.caPem = f.caPem;
    if (f.authMode === "static") {
      payload.accessKeyId = f.accessKeyId;
      payload.secretAccessKey = f.secretAccessKey;
    } else payload.filesDir = f.filesDir;
    try {
      await api("/api/targets", "POST", payload);
      toast.success(`Target “${f.name}” added`);
      setF({ ...f, name: "", secretAccessKey: "" });
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a target</DialogTitle>
          <DialogDescription>Point the console at an emulator endpoint.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          {filesEnabled && (
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={preset}>
              Use the local docker emulator preset
            </Button>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" required value={f.name} onChange={set("name")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-url">Endpoint URL</Label>
            <Input
              id="t-url"
              required
              placeholder="https://host:9297"
              value={f.endpointUrl}
              onChange={set("endpointUrl")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="t-region">Region</Label>
              <Input id="t-region" value={f.region} onChange={set("region")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-sni">Verify TLS as (optional)</Label>
              <Input id="t-sni" value={f.tlsServername} onChange={set("tlsServername")} placeholder="localhost" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-auth">Credentials</Label>
            <Select id="t-auth" value={f.authMode} onChange={set("authMode")}>
              {filesEnabled && <option value="files">Read from the emulator&apos;s files</option>}
              <option value="static">Access key + secret</option>
            </Select>
          </div>
          {f.authMode === "files" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="t-dir">Directory under the credentials root</Label>
              <Input id="t-dir" required placeholder="9297" value={f.filesDir} onChange={set("filesDir")} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="t-ak">Access key id</Label>
                  <Input id="t-ak" required value={f.accessKeyId} onChange={set("accessKeyId")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="t-sk">Secret access key</Label>
                  <Input
                    id="t-sk"
                    type="password"
                    autoComplete="off"
                    required
                    value={f.secretAccessKey}
                    onChange={set("secretAccessKey")}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t-ca">CA certificate (PEM), if the endpoint uses a private CA</Label>
                <Textarea id="t-ca" className="min-h-20 text-xs" value={f.caPem} onChange={set("caPem")} />
              </div>
            </>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy}>{busy && <Spinner />} Add target</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
