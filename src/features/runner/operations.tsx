"use client";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { serviceMeta, SERVICES } from "@/features/services";
import { api } from "@/lib/client";
import { isMutating } from "@/lib/mutating";

export function ServiceIndex() {
  const { tid } = useTarget();
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title="All operations"
        description="Run any operation of any service. Forms are generated from the AWS SDK's own definitions."
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((s) => (
          <Link
            key={s.id}
            href={`/t/${tid}/s/${s.id}`}
            className="flex items-center gap-2 rounded-lg border p-3 hover:bg-accent/40"
          >
            <s.icon className="size-4 text-primary" />
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function OperationList({ svc }: { svc: string }) {
  const { tid } = useTarget();
  const meta = serviceMeta(svc);
  const [q, setQ] = useState("");
  const ops = useQuery({
    queryKey: ["operations", tid, svc],
    queryFn: () => api<string[]>(`/api/targets/${tid}/${svc}`),
    staleTime: Infinity,
  });
  const list = (ops.data ?? []).filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <PageHeader
        title={`${meta?.label ?? svc} operations`}
        description={`${ops.data?.length ?? "…"} operations. Pick one to fill in its input and run it.`}
      >
        <Link href={`/t/${tid}/s`} className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← All services
        </Link>
      </PageHeader>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search operations"
          aria-label="Search operations"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      {ops.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="operations">
          {list.map((o) => (
            <Link
              key={o}
              href={`/t/${tid}/s/${svc}/${o}`}
              className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent/50"
            >
              <span className="truncate font-mono text-xs">{o}</span>
              <Badge variant={isMutating(o) ? "outline" : "default"}>{isMutating(o) ? "write" : "read"}</Badge>
            </Link>
          ))}
          {list.length === 0 && <p className="text-sm text-muted-foreground">No operation matches “{q}”.</p>}
        </div>
      )}
    </div>
  );
}
