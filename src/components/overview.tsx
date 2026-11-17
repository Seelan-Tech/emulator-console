"use client";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { JsonViewer, PageHeader, Spinner } from "@/components/common";
import { useTargetStatus } from "@/components/restart-banner";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { GROUPS, serviceHref, SERVICES } from "@/features/services";
import { cliExports, emulatorPort } from "@/lib/cli-env";
import { api } from "@/lib/client";
import { timeAgo } from "@/lib/utils";

type Probe = { service: string; available: boolean | null; detail?: string };
type TargetFiles = { authMode: string; filesDir: string | null };

// The AWS CLI needs the emulator's own credential files, which only a target in files mode has; a static key's secret
// never leaves the server.
function CliAccess() {
  const { tid, endpointUrl, region } = useTarget();
  const [open, setOpen] = useState(false);
  const target = useQuery({
    queryKey: ["target", tid, "files"],
    queryFn: () => api<TargetFiles>(`/api/targets/${tid}`),
  });
  const status = useTargetStatus(tid);
  const port = target.data?.authMode === "files" ? emulatorPort(target.data.filesDir, endpointUrl) : null;
  if (!port) return null;
  const restarted = status.data?.restartedAt;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Terminal /> Use with the AWS CLI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Use with the AWS CLI</DialogTitle>
            <DialogDescription>
              Paste this into a shell. It reads the emulator&apos;s own credentials and CA from{" "}
              <code>~/.aws/emulator/{port}/</code>, in region {region} (the CLI does not follow the region picker).
            </DialogDescription>
          </DialogHeader>
          <JsonViewer value={cliExports({ port, region })} />
          <p className="text-sm text-muted-foreground">
            The keys and the CA are regenerated every time the emulator restarts, so run this again (or open a new
            shell) afterwards.
            {restarted && <> The emulator last restarted {timeAgo(restarted)}: shells opened before then need it.</>}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Overview() {
  const { tid, name, endpointUrl, region } = useTarget();
  const base = `/t/${tid}`;
  const probes = useQuery({
    queryKey: [tid, "discovery"],
    queryFn: () => api<Probe[]>(`/api/targets/${tid}/discovery`),
    staleTime: 30_000,
  });
  const by = new Map(probes.data?.map((p) => [p.service, p]));

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <PageHeader
        title={name}
        description={
          <span className="font-mono text-xs">
            {endpointUrl} · {region}
          </span>
        }
        actions={
          <>
            <CliAccess />
            <Button variant="outline" onClick={() => probes.refetch()} disabled={probes.isFetching}>
              {probes.isFetching ? <Spinner /> : <RefreshCw />} Rescan services
            </Button>
          </>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        The emulator has no API that lists its services, so each one is probed with a cheap read. Open any service to
        work with its resources.
      </p>
      {GROUPS.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.filter((s) => s.group === g).map((s) => {
              const p = by.get(s.id);
              return (
                <Link key={s.id} href={serviceHref(base, s)} data-testid={`svc-${s.id}`}>
                  <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/40">
                    <s.icon className="size-5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.label}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p?.available === false ? p.detail : s.id}
                      </div>
                    </div>
                    {probes.isLoading ? (
                      <Skeleton className="h-5 w-16" />
                    ) : p?.available === true ? (
                      <Badge variant="success">available</Badge>
                    ) : p?.available === false ? (
                      <Badge variant="destructive">unsupported</Badge>
                    ) : (
                      <Badge variant="warning">unknown</Badge>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
