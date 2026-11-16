"use client";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";

import { PageHeader, Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GROUPS, serviceHref, SERVICES } from "@/features/services";
import { api } from "@/lib/client";

type Probe = { service: string; available: boolean | null; detail?: string };

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
          <Button variant="outline" onClick={() => probes.refetch()} disabled={probes.isFetching}>
            {probes.isFetching ? <Spinner /> : <RefreshCw />} Rescan services
          </Button>
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
