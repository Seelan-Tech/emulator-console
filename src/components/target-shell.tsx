"use client";
import { GitFork, LayoutDashboard, ListTree, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { RecorderDrawer } from "@/components/recorder";
import { RestartBanner, useTargetStatus } from "@/components/restart-banner";
import { useTarget } from "@/components/target-context";
import { TargetSettings } from "@/components/target-settings";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { GROUPS, REGIONS, serviceHref, SERVICES } from "@/features/services";
import { useOp } from "@/lib/aws-client";
import { emulatorTitle } from "@/lib/emulator-version";
import { cn } from "@/lib/utils";

function ConnectionChip() {
  const { data, isError, isLoading } = useOp<{ Arn?: string }>(
    "sts",
    "GetCallerIdentity",
    {},
    { refetchInterval: 15_000 },
  );
  const label = isLoading ? "checking…" : isError ? "unreachable" : "connected";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={data?.Arn}
      data-testid="connection"
    >
      <span
        className={cn("size-2 rounded-full", isLoading ? "bg-warning" : isError ? "bg-destructive" : "bg-success")}
      />
      {label}
    </span>
  );
}

export function TargetShell({ children }: { children: React.ReactNode }) {
  const { tid, name, endpointUrl, region, setRegion } = useTarget();
  const path = usePathname();
  const [settings, setSettings] = useState(false);
  const emulator = useTargetStatus(tid).data?.emulator;
  const base = `/t/${tid}`;
  const item = (href: string, active: boolean, children: React.ReactNode, key?: string) => (
    <Link
      key={key ?? href}
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground [&_svg]:size-4",
        active && "bg-accent font-medium text-accent-foreground",
      )}
    >
      {children}
    </Link>
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0">
      <aside
        className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r bg-card/50 p-3 md:flex"
        aria-label="Services"
      >
        {item(
          base,
          path === base,
          <>
            <LayoutDashboard />
            Overview
          </>,
        )}
        {item(
          `${base}/flow`,
          path.startsWith(`${base}/flow`),
          <>
            <GitFork />
            Message flow
          </>,
        )}
        {GROUPS.map((g) => (
          <div key={g} className="mt-4">
            <div className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {g}
            </div>
            {SERVICES.filter((s) => s.group === g).map((s) => {
              const href = serviceHref(base, s);
              const active = s.native ? path.startsWith(`${base}/${s.native}`) : false;
              return item(
                href,
                active,
                <>
                  <s.icon />
                  {s.label}
                </>,
                s.id,
              );
            })}
          </div>
        ))}
        <div className="mt-4 border-t pt-3">
          {item(
            `${base}/s`,
            path.startsWith(`${base}/s/`) || path === `${base}/s`,
            <>
              <ListTree />
              All operations
            </>,
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
          <span className="font-medium">{name}</span>
          <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{endpointUrl}</span>
          {emulator && (
            <span
              className="text-xs text-muted-foreground"
              title={emulatorTitle(emulator)}
              data-testid="emulator-version"
            >
              Emulator {emulator.version}
            </span>
          )}
          <ConnectionChip />
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Restart recovery settings"
              onClick={() => setSettings(true)}
            >
              <Settings />
            </Button>
            <span className="text-xs text-muted-foreground">Region</span>
            <Select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-8 w-40 text-xs"
              aria-label="Region"
            >
              {[...new Set([region, ...REGIONS])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </div>
        </div>
        <RestartBanner onChooseBaseline={() => setSettings(true)} />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <RecorderDrawer />
        <TargetSettings targetId={tid} open={settings} onOpenChange={setSettings} />
      </div>
    </div>
  );
}
